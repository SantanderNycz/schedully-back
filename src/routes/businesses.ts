import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { and, eq, ne } from 'drizzle-orm';
import { db } from '../db';
import { businesses } from '../db/schema';
import { authenticate, requireRole } from '../middleware/auth';

const router = Router();

const updateSchema = z.object({
  name: z.string().min(2).max(100),
});

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

// PATCH /api/businesses/me — update business name and slug
router.patch('/me', authenticate, requireRole('owner'), async (req: Request, res: Response) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const newSlug = toSlug(parsed.data.name);

  try {
    const conflict = await db.query.businesses.findFirst({
      where: and(eq(businesses.slug, newSlug), ne(businesses.ownerId, req.user!.userId)),
    });

    if (conflict) {
      return res.status(409).json({ error: 'This name generates a URL already in use. Try a different name.' });
    }

    const [updated] = await db
      .update(businesses)
      .set({ name: parsed.data.name, slug: newSlug, updatedAt: new Date() })
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
