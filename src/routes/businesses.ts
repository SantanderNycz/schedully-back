import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { businesses } from '../db/schema';
import { authenticate, requireRole } from '../middleware/auth';

const router = Router();

const updateSchema = z.object({
  name: z.string().min(2).max(100),
});

// PATCH /api/businesses/me — update business name
router.patch('/me', authenticate, requireRole('owner'), async (req: Request, res: Response) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  try {
    const [updated] = await db
      .update(businesses)
      .set({ name: parsed.data.name, updatedAt: new Date() })
      .where(eq(businesses.ownerId, req.user!.userId))
      .returning();

    if (!updated) {
      return res.status(404).json({ error: 'Business not found' });
    }

    return res.json({
      business: { id: updated.id, name: updated.name, slug: updated.slug, plan: updated.plan },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
