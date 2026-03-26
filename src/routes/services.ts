import { Router, Request, Response } from 'express';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { services, businesses } from '../db/schema';
import { authenticate, requireRole } from '../middleware/auth';

const router = Router();

const serviceSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().optional(),
  durationMinutes: z.number().int().min(15).max(480),
  price: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Invalid price format'),
});

// Helper — get the business owned by the current user
async function getOwnerBusiness(userId: string) {
  return db.query.businesses.findFirst({
    where: eq(businesses.ownerId, userId),
  });
}

// GET /api/services — list services for the authenticated owner's business
router.get('/', authenticate, requireRole('owner'), async (req: Request, res: Response) => {
  const business = await getOwnerBusiness(req.user!.userId);
  if (!business) return res.status(404).json({ error: 'Business not found' });

  const result = await db.query.services.findMany({
    where: eq(services.businessId, business.id),
    orderBy: (s, { asc }) => [asc(s.name)],
  });

  return res.json(result);
});

// GET /api/services/public/:slug — public list for booking page (no auth)
router.get('/public/:slug', async (req: Request, res: Response) => {
  const business = await db.query.businesses.findFirst({
    where: eq(businesses.slug, req.params.slug),
  });
  if (!business) return res.status(404).json({ error: 'Business not found' });

  const result = await db.query.services.findMany({
    where: and(eq(services.businessId, business.id), eq(services.active, true)),
    orderBy: (s, { asc }) => [asc(s.name)],
  });

  return res.json({ business, services: result });
});

// POST /api/services — create a service
router.post('/', authenticate, requireRole('owner'), async (req: Request, res: Response) => {
  const parsed = serviceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const business = await getOwnerBusiness(req.user!.userId);
  if (!business) return res.status(404).json({ error: 'Business not found' });

  const [service] = await db
    .insert(services)
    .values({ ...parsed.data, businessId: business.id })
    .returning();

  return res.status(201).json(service);
});

// PUT /api/services/:id — update a service
router.put('/:id', authenticate, requireRole('owner'), async (req: Request, res: Response) => {
  const parsed = serviceSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const business = await getOwnerBusiness(req.user!.userId);
  if (!business) return res.status(404).json({ error: 'Business not found' });

  const [updated] = await db
    .update(services)
    .set({ ...parsed.data, })
    .where(and(eq(services.id, req.params.id), eq(services.businessId, business.id)))
    .returning();

  if (!updated) return res.status(404).json({ error: 'Service not found' });
  return res.json(updated);
});

// DELETE /api/services/:id — soft delete (set active = false)
router.delete('/:id', authenticate, requireRole('owner'), async (req: Request, res: Response) => {
  const business = await getOwnerBusiness(req.user!.userId);
  if (!business) return res.status(404).json({ error: 'Business not found' });

  const [updated] = await db
    .update(services)
    .set({ active: false })
    .where(and(eq(services.id, req.params.id), eq(services.businessId, business.id)))
    .returning();

  if (!updated) return res.status(404).json({ error: 'Service not found' });
  return res.json({ success: true });
});

export default router;
