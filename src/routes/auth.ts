import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { users, businesses } from '../db/schema';
import { authenticate } from '../middleware/auth';

const router = Router();

// ─── Validation schemas ────────────────────────────────────────────────────

const registerOwnerSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(8),
  businessName: z.string().min(2).max(100),
  businessSlug: z
    .string()
    .min(2)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
});

const registerClientSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// ─── Helper ────────────────────────────────────────────────────────────────

function generateToken(userId: string, email: string, role: 'owner' | 'client') {
  return jwt.sign({ userId, email, role }, process.env.JWT_SECRET!, {
    expiresIn: '7d',
  });
}

// ─── Routes ────────────────────────────────────────────────────────────────

// POST /api/auth/register/owner — create business account
router.post('/register/owner', async (req: Request, res: Response) => {
  const parsed = registerOwnerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { name, email, password, businessName, businessSlug } = parsed.data;

  try {
    // Check email uniqueness
    const existing = await db.query.users.findFirst({
      where: eq(users.email, email),
    });
    if (existing) {
      return res.status(409).json({ error: 'Email already in use' });
    }

    // Check slug uniqueness
    const existingSlug = await db.query.businesses.findFirst({
      where: eq(businesses.slug, businessSlug),
    });
    if (existingSlug) {
      return res.status(409).json({ error: 'Business slug already taken' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // Create user + business in a transaction-like sequence
    const [newUser] = await db
      .insert(users)
      .values({ name, email, passwordHash, role: 'owner' })
      .returning();

    const [newBusiness] = await db
      .insert(businesses)
      .values({ ownerId: newUser.id, name: businessName, slug: businessSlug })
      .returning();

    const token = generateToken(newUser.id, newUser.email, 'owner');

    return res.status(201).json({
      token,
      user: { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role },
      business: { id: newBusiness.id, name: newBusiness.name, slug: newBusiness.slug },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/register/client — create client account
router.post('/register/client', async (req: Request, res: Response) => {
  const parsed = registerClientSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { name, email, password } = parsed.data;

  try {
    const existing = await db.query.users.findFirst({
      where: eq(users.email, email),
    });
    if (existing) {
      return res.status(409).json({ error: 'Email already in use' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const [newUser] = await db
      .insert(users)
      .values({ name, email, passwordHash, role: 'client' })
      .returning();

    const token = generateToken(newUser.id, newUser.email, 'client');

    return res.status(201).json({
      token,
      user: { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/login — works for both roles
router.post('/login', async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { email, password } = parsed.data;

  try {
    const user = await db.query.users.findFirst({
      where: eq(users.email, email),
      with: { business: true },
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(user.id, user.email, user.role);

    return res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      business: user.business ?? null,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/auth/me — get current user info
router.get('/me', authenticate, async (req: Request, res: Response) => {
  try {
    const user = await db.query.users.findFirst({
      where: eq(users.id, req.user!.userId),
      with: { business: true },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      business: user.business ?? null,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
