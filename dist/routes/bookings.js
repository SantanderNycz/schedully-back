"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateSlots = generateSlots;
const express_1 = require("express");
const drizzle_orm_1 = require("drizzle-orm");
const zod_1 = require("zod");
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const auth_1 = require("../middleware/auth");
const email_1 = require("../lib/email");
const router = (0, express_1.Router)();
// ─── Slots engine ──────────────────────────────────────────────────────────
//
// Given a business, a service, and a date:
// 1. Check if that day of week is in availability
// 2. Generate all possible slots based on service duration
// 3. Filter out slots already taken by existing bookings
//
function generateSlots(startTime, // "09:00"
endTime, // "18:00"
durationMinutes, bookedSlots) {
    const toMinutes = (t) => {
        const [h, m] = t.split(':').map(Number);
        return h * 60 + m;
    };
    const toTime = (mins) => {
        const h = Math.floor(mins / 60).toString().padStart(2, '0');
        const m = (mins % 60).toString().padStart(2, '0');
        return `${h}:${m}`;
    };
    const start = toMinutes(startTime);
    const end = toMinutes(endTime);
    const slots = [];
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
router.get('/slots', async (req, res) => {
    const { slug, serviceId, date } = req.query;
    if (!slug || !serviceId || !date) {
        return res.status(400).json({ error: 'slug, serviceId, and date are required' });
    }
    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: 'Date must be YYYY-MM-DD' });
    }
    const business = await db_1.db.query.businesses.findFirst({
        where: (0, drizzle_orm_1.eq)(schema_1.businesses.slug, slug),
    });
    if (!business)
        return res.status(404).json({ error: 'Business not found' });
    const service = await db_1.db.query.services.findFirst({
        where: (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.services.id, serviceId), (0, drizzle_orm_1.eq)(schema_1.services.businessId, business.id)),
    });
    if (!service)
        return res.status(404).json({ error: 'Service not found' });
    // Get day of week (0 = Sunday)
    const dayOfWeek = new Date(date + 'T12:00:00').getDay();
    const availability = await db_1.db.query.availabilities.findFirst({
        where: (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.availabilities.businessId, business.id), (0, drizzle_orm_1.eq)(schema_1.availabilities.dayOfWeek, dayOfWeek)),
    });
    if (!availability) {
        return res.json({ slots: [], message: 'Business is closed on this day' });
    }
    // Get existing bookings for this business on this date (not cancelled)
    const existingBookings = await db_1.db.query.bookings.findMany({
        where: (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.bookings.businessId, business.id), (0, drizzle_orm_1.eq)(schema_1.bookings.date, date)),
    });
    const bookedSlots = existingBookings
        .filter((b) => b.status !== 'cancelled')
        .map((b) => ({ startTime: b.startTime, endTime: b.endTime }));
    const slots = generateSlots(availability.startTime, availability.endTime, service.durationMinutes, bookedSlots);
    return res.json({ slots, availability, service });
});
// ─── POST /api/bookings ────────────────────────────────────────────────────
const createBookingSchema = zod_1.z.object({
    slug: zod_1.z.string(),
    serviceId: zod_1.z.string().uuid(),
    date: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    startTime: zod_1.z.string().regex(/^\d{2}:\d{2}$/),
    notes: zod_1.z.string().optional(),
});
router.post('/', auth_1.authenticate, async (req, res) => {
    const parsed = createBookingSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    const { slug, serviceId, date, startTime, notes } = parsed.data;
    const business = await db_1.db.query.businesses.findFirst({
        where: (0, drizzle_orm_1.eq)(schema_1.businesses.slug, slug),
    });
    if (!business)
        return res.status(404).json({ error: 'Business not found' });
    const service = await db_1.db.query.services.findFirst({
        where: (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.services.id, serviceId), (0, drizzle_orm_1.eq)(schema_1.services.businessId, business.id)),
    });
    if (!service)
        return res.status(404).json({ error: 'Service not found' });
    // Calculate end time
    const toMinutes = (t) => {
        const [h, m] = t.split(':').map(Number);
        return h * 60 + m;
    };
    const endMinutes = toMinutes(startTime) + service.durationMinutes;
    const endTime = `${Math.floor(endMinutes / 60).toString().padStart(2, '0')}:${(endMinutes % 60).toString().padStart(2, '0')}`;
    // Check the slot is still available
    const dayOfWeek = new Date(date + 'T12:00:00').getDay();
    const availability = await db_1.db.query.availabilities.findFirst({
        where: (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.availabilities.businessId, business.id), (0, drizzle_orm_1.eq)(schema_1.availabilities.dayOfWeek, dayOfWeek)),
    });
    if (!availability)
        return res.status(400).json({ error: 'Business is closed on this day' });
    const existingBookings = await db_1.db.query.bookings.findMany({
        where: (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.bookings.businessId, business.id), (0, drizzle_orm_1.eq)(schema_1.bookings.date, date)),
    });
    const bookedSlots = existingBookings
        .filter((b) => b.status !== 'cancelled')
        .map((b) => ({ startTime: b.startTime, endTime: b.endTime }));
    const availableSlots = generateSlots(availability.startTime, availability.endTime, service.durationMinutes, bookedSlots);
    if (!availableSlots.includes(startTime)) {
        return res.status(409).json({ error: 'This slot is no longer available' });
    }
    const [booking] = await db_1.db
        .insert(schema_1.bookings)
        .values({
        businessId: business.id,
        serviceId: service.id,
        clientId: req.user.userId,
        date,
        startTime,
        endTime,
        notes,
        status: 'pending',
    })
        .returning();
    // Send emails — fire-and-forget (don't block the response)
    const [client, owner] = await Promise.all([
        db_1.db.query.users.findFirst({ where: (0, drizzle_orm_1.eq)(schema_1.users.id, req.user.userId) }),
        db_1.db.query.users.findFirst({ where: (0, drizzle_orm_1.eq)(schema_1.users.id, business.ownerId) }),
    ]);
    if (client && owner) {
        (0, email_1.sendBookingCreated)({
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
router.get('/', auth_1.authenticate, async (req, res) => {
    if (req.user.role === 'owner') {
        const business = await db_1.db.query.businesses.findFirst({
            where: (0, drizzle_orm_1.eq)(schema_1.businesses.ownerId, req.user.userId),
        });
        if (!business)
            return res.status(404).json({ error: 'Business not found' });
        const result = await db_1.db.query.bookings.findMany({
            where: (0, drizzle_orm_1.eq)(schema_1.bookings.businessId, business.id),
            with: { client: true, service: true },
            orderBy: (b, { desc }) => [desc(b.date), desc(b.startTime)],
        });
        return res.json(result);
    }
    else {
        const result = await db_1.db.query.bookings.findMany({
            where: (0, drizzle_orm_1.eq)(schema_1.bookings.clientId, req.user.userId),
            with: { business: true, service: true },
            orderBy: (b, { desc }) => [desc(b.date), desc(b.startTime)],
        });
        return res.json(result);
    }
});
// ─── PATCH /api/bookings/:id/status ───────────────────────────────────────
const statusSchema = zod_1.z.object({
    status: zod_1.z.enum(['confirmed', 'cancelled']),
});
router.patch('/:id/status', auth_1.authenticate, (0, auth_1.requireRole)('owner'), async (req, res) => {
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    const business = await db_1.db.query.businesses.findFirst({
        where: (0, drizzle_orm_1.eq)(schema_1.businesses.ownerId, req.user.userId),
    });
    if (!business)
        return res.status(404).json({ error: 'Business not found' });
    const [updated] = await db_1.db
        .update(schema_1.bookings)
        .set({ status: parsed.data.status, updatedAt: new Date() })
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.bookings.id, req.params.id), (0, drizzle_orm_1.eq)(schema_1.bookings.businessId, business.id)))
        .returning();
    if (!updated)
        return res.status(404).json({ error: 'Booking not found' });
    // Send status update email to client — fire-and-forget
    const [client, service] = await Promise.all([
        db_1.db.query.users.findFirst({ where: (0, drizzle_orm_1.eq)(schema_1.users.id, updated.clientId) }),
        db_1.db.query.services.findFirst({ where: (0, drizzle_orm_1.eq)(schema_1.services.id, updated.serviceId) }),
    ]);
    if (client && service) {
        (0, email_1.sendBookingStatusUpdate)({
            clientName: client.name,
            clientEmail: client.email,
            ownerEmail: req.user.email,
            businessName: business.name,
            serviceName: service.name,
            date: updated.date,
            startTime: updated.startTime,
            endTime: updated.endTime,
            price: service.price,
            notes: updated.notes ?? undefined,
        }, parsed.data.status).catch((err) => console.error('Failed to send status email:', err));
    }
    return res.json(updated);
});
exports.default = router;
