import { Router, Request, Response } from 'express';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { bookings, services, availabilities, businesses, users } from '../db/schema';
import { authenticate, requireRole } from '../middleware/auth';
import { sendBookingCreated, sendBookingStatusUpdate } from '../lib/email';

const router = Router();

// ─── Slots engine ──────────────────────────────────────────────────────────
//
// Given a business, a service, and a date:
// 1. Check if that day of week is in availability
// 2. Generate all possible slots based on service duration
// 3. Filter out slots already taken by existing bookings
//
export function generateSlots(
  startTime: string,   // "09:00"
  endTime: string,     // "18:00"
  durationMinutes: number,
  bookedSlots: { startTime: string; endTime: string }[]
): string[] {
  const toMinutes = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const toTime = (mins: number) => {
    const h = Math.floor(mins / 60).toString().padStart(2, '0');
    const m = (mins % 60).toString().padStart(2, '0');
    return `${h}:${m}`;
  };

  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  const slots: string[] = [];

  for (let current = start; current + durationMinutes <= end; current += durationMinutes) {
    const slotStart = toTime(current);
    const slotEnd = toTime(current + durationMinutes);

    // Check if this slot overlaps with any existing booking
    const isBooked = bookedSlots.some((b) => {
      const bStart = toMinutes(b.startTime);
      const bEnd = toMinutes(b.endTime);
      const sStart = current;
      const sEnd = current + durationMinutes;
      // Overlap check: not (sEnd <= bStart || sStart >= bEnd)
      return !(sEnd <= bStart || sStart >= bEnd);
    });

    if (!isBooked) {
      slots.push(slotStart);
    }
  }

  return slots;
}

// ─── GET /api/bookings/slots ───────────────────────────────────────────────
// Query: ?slug=business-slug&serviceId=uuid&date=YYYY-MM-DD
router.get('/slots', async (req: Request, res: Response) => {
  const { slug, serviceId, date } = req.query as Record<string, string>;

  if (!slug || !serviceId || !date) {
    return res.status(400).json({ error: 'slug, serviceId, and date are required' });
  }

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Date must be YYYY-MM-DD' });
  }

  const business = await db.query.businesses.findFirst({
    where: eq(businesses.slug, slug),
  });
  if (!business) return res.status(404).json({ error: 'Business not found' });

  const service = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.businessId, business.id)),
  });
  if (!service) return res.status(404).json({ error: 'Service not found' });

  // Get day of week (0 = Sunday)
  const dayOfWeek = new Date(date + 'T12:00:00').getDay();

  const availability = await db.query.availabilities.findFirst({
    where: and(
      eq(availabilities.businessId, business.id),
      eq(availabilities.dayOfWeek, dayOfWeek)
    ),
  });

  if (!availability) {
    return res.json({ slots: [], message: 'Business is closed on this day' });
  }

  // Get existing bookings for this business on this date (not cancelled)
  const existingBookings = await db.query.bookings.findMany({
    where: and(
      eq(bookings.businessId, business.id),
      eq(bookings.date, date)
    ),
  });

  const bookedSlots = existingBookings
    .filter((b) => b.status !== 'cancelled')
    .map((b) => ({ startTime: b.startTime, endTime: b.endTime }));

  const slots = generateSlots(
    availability.startTime,
    availability.endTime,
    service.durationMinutes,
    bookedSlots
  );

  return res.json({ slots, availability, service });
});

// ─── POST /api/bookings ────────────────────────────────────────────────────
const createBookingSchema = z.object({
  slug: z.string(),
  serviceId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  notes: z.string().optional(),
});

router.post('/', authenticate, async (req: Request, res: Response) => {
  const parsed = createBookingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { slug, serviceId, date, startTime, notes } = parsed.data;

  const business = await db.query.businesses.findFirst({
    where: eq(businesses.slug, slug),
  });
  if (!business) return res.status(404).json({ error: 'Business not found' });

  const service = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.businessId, business.id)),
  });
  if (!service) return res.status(404).json({ error: 'Service not found' });

  // Calculate end time
  const toMinutes = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const endMinutes = toMinutes(startTime) + service.durationMinutes;
  const endTime = `${Math.floor(endMinutes / 60).toString().padStart(2, '0')}:${(endMinutes % 60).toString().padStart(2, '0')}`;

  // Check the slot is still available
  const dayOfWeek = new Date(date + 'T12:00:00').getDay();
  const availability = await db.query.availabilities.findFirst({
    where: and(
      eq(availabilities.businessId, business.id),
      eq(availabilities.dayOfWeek, dayOfWeek)
    ),
  });
  if (!availability) return res.status(400).json({ error: 'Business is closed on this day' });

  const existingBookings = await db.query.bookings.findMany({
    where: and(eq(bookings.businessId, business.id), eq(bookings.date, date)),
  });

  const bookedSlots = existingBookings
    .filter((b) => b.status !== 'cancelled')
    .map((b) => ({ startTime: b.startTime, endTime: b.endTime }));

  const availableSlots = generateSlots(
    availability.startTime,
    availability.endTime,
    service.durationMinutes,
    bookedSlots
  );

  if (!availableSlots.includes(startTime)) {
    return res.status(409).json({ error: 'This slot is no longer available' });
  }

  const [booking] = await db
    .insert(bookings)
    .values({
      businessId: business.id,
      serviceId: service.id,
      clientId: req.user!.userId,
      date,
      startTime,
      endTime,
      notes,
      status: 'pending',
    })
    .returning();

  // Send emails — fire-and-forget (don't block the response)
  const [client, owner] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.id, req.user!.userId) }),
    db.query.users.findFirst({ where: eq(users.id, business.ownerId) }),
  ]);

  if (client && owner) {
    sendBookingCreated({
      clientName: client.name,
      clientEmail: client.email,
      ownerEmail: owner.email,
      businessName: business.name,
      serviceName: service.name,
      date,
      startTime,
      endTime,
      price: service.price,
      notes,
    }).catch((err) => console.error('Failed to send booking emails:', err));
  }

  return res.status(201).json(booking);
});

// ─── GET /api/bookings ─────────────────────────────────────────────────────
// Owner: sees all bookings for their business
// Client: sees only their own bookings
router.get('/', authenticate, async (req: Request, res: Response) => {
  if (req.user!.role === 'owner') {
    const business = await db.query.businesses.findFirst({
      where: eq(businesses.ownerId, req.user!.userId),
    });
    if (!business) return res.status(404).json({ error: 'Business not found' });

    const result = await db.query.bookings.findMany({
      where: eq(bookings.businessId, business.id),
      with: { client: true, service: true },
      orderBy: (b, { desc }) => [desc(b.date), desc(b.startTime)],
    });

    return res.json(result);
  } else {
    const result = await db.query.bookings.findMany({
      where: eq(bookings.clientId, req.user!.userId),
      with: { business: true, service: true },
      orderBy: (b, { desc }) => [desc(b.date), desc(b.startTime)],
    });

    return res.json(result);
  }
});

// ─── PATCH /api/bookings/:id/status ───────────────────────────────────────
const statusSchema = z.object({
  status: z.enum(['confirmed', 'cancelled']),
});

router.patch('/:id/status', authenticate, requireRole('owner'), async (req: Request, res: Response) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const business = await db.query.businesses.findFirst({
    where: eq(businesses.ownerId, req.user!.userId),
  });
  if (!business) return res.status(404).json({ error: 'Business not found' });

  const [updated] = await db
    .update(bookings)
    .set({ status: parsed.data.status, updatedAt: new Date() })
    .where(and(eq(bookings.id, req.params.id), eq(bookings.businessId, business.id)))
    .returning();

  if (!updated) return res.status(404).json({ error: 'Booking not found' });

  // Send status update email to client — fire-and-forget
  const [client, service] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.id, updated.clientId) }),
    db.query.services.findFirst({ where: eq(services.id, updated.serviceId) }),
  ]);

  if (client && service) {
    sendBookingStatusUpdate(
      {
        clientName: client.name,
        clientEmail: client.email,
        ownerEmail: req.user!.email,
        businessName: business.name,
        serviceName: service.name,
        date: updated.date,
        startTime: updated.startTime,
        endTime: updated.endTime,
        price: service.price,
        notes: updated.notes ?? undefined,
      },
      parsed.data.status
    ).catch((err) => console.error('Failed to send status email:', err));
  }

  return res.json(updated);
});

export default router;
