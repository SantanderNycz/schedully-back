import { Router, Request, Response } from 'express';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { availabilities, businesses } from '../db/schema';
import { authenticate, requireRole } from '../middleware/auth';

const router = Router();

const availabilitySchema = z.object({
  // Array of day configs — replace all at once (simpler UX)
  slots: z.array(
    z.object({
      dayOfWeek: z.number().int().min(0).max(6),
      startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Format HH:MM'),
      endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Format HH:MM'),
    }).refine((s) => s.startTime < s.endTime, {
      message: 'startTime must be before endTime',
    })
  ),
});

async function getOwnerBusiness(userId: string) {
  return db.query.businesses.findFirst({
    where: eq(businesses.ownerId, userId),
  });
}

// GET /api/availability — get current availability for owner
router.get('/', authenticate, requireRole('owner'), async (req: Request, res: Response) => {
  const business = await getOwnerBusiness(req.user!.userId);
  if (!business) return res.status(404).json({ error: 'Business not found' });

  const result = await db.query.availabilities.findMany({
    where: eq(availabilities.businessId, business.id),
    orderBy: (a, { asc }) => [asc(a.dayOfWeek)],
  });

  return res.json(result);
});

// GET /api/availability/public/:slug — public availability for booking page
router.get('/public/:slug', async (req: Request, res: Response) => {
  const business = await db.query.businesses.findFirst({
    where: eq(businesses.slug, req.params.slug),
  });
  if (!business) return res.status(404).json({ error: 'Business not found' });

  const result = await db.query.availabilities.findMany({
    where: eq(availabilities.businessId, business.id),
    orderBy: (a, { asc }) => [asc(a.dayOfWeek)],
  });

  return res.json(result);
});

// POST /api/availability — replace entire weekly schedule
router.post('/', authenticate, requireRole('owner'), async (req: Request, res: Response) => {
  try {
    const parsed = availabilitySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const business = await getOwnerBusiness(req.user!.userId);
    if (!business) return res.status(404).json({ error: 'Business not found' });

    // Delete existing then insert new (sequential — neon-http doesn't support transactions)
    await db.delete(availabilities).where(eq(availabilities.businessId, business.id));

    if (parsed.data.slots.length > 0) {
      await db.insert(availabilities).values(
        parsed.data.slots.map((slot) => ({ ...slot, businessId: business.id }))
      );
    }

    // Return the saved slots directly — avoids an extra DB round-trip
    return res.json(parsed.data.slots);
  } catch (err) {
    console.error('Availability save error:', err);
    return res.status(500).json({ error: 'Failed to save availability' });
  }
});

export default router;
