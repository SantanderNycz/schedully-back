"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const zod_1 = require("zod");
const drizzle_orm_1 = require("drizzle-orm");
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// ─── Validation schemas ────────────────────────────────────────────────────
const registerOwnerSchema = zod_1.z.object({
    name: zod_1.z.string().min(2).max(100),
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(8),
    businessName: zod_1.z.string().min(2).max(100),
    businessSlug: zod_1.z
        .string()
        .min(2)
        .max(100)
        .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
});
const registerClientSchema = zod_1.z.object({
    name: zod_1.z.string().min(2).max(100),
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(8),
});
const loginSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(1),
});
// ─── Helper ────────────────────────────────────────────────────────────────
function generateToken(userId, email, role) {
    return jsonwebtoken_1.default.sign({ userId, email, role }, process.env.JWT_SECRET, {
        expiresIn: '7d',
    });
}
// ─── Routes ────────────────────────────────────────────────────────────────
// POST /api/auth/register/owner — create business account
router.post('/register/owner', async (req, res) => {
    const parsed = registerOwnerSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
    }
    const { name, email, password, businessName, businessSlug } = parsed.data;
    try {
        // Check email uniqueness
        const existing = await db_1.db.query.users.findFirst({
            where: (0, drizzle_orm_1.eq)(schema_1.users.email, email),
        });
        if (existing) {
            return res.status(409).json({ error: 'Email already in use' });
        }
        // Check slug uniqueness
        const existingSlug = await db_1.db.query.businesses.findFirst({
            where: (0, drizzle_orm_1.eq)(schema_1.businesses.slug, businessSlug),
        });
        if (existingSlug) {
            return res.status(409).json({ error: 'Business slug already taken' });
        }
        const passwordHash = await bcryptjs_1.default.hash(password, 12);
        // Create user + business in a transaction-like sequence
        const [newUser] = await db_1.db
            .insert(schema_1.users)
            .values({ name, email, passwordHash, role: 'owner' })
            .returning();
        const [newBusiness] = await db_1.db
            .insert(schema_1.businesses)
            .values({ ownerId: newUser.id, name: businessName, slug: businessSlug })
            .returning();
        const token = generateToken(newUser.id, newUser.email, 'owner');
        return res.status(201).json({
            token,
            user: { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role },
            business: { id: newBusiness.id, name: newBusiness.name, slug: newBusiness.slug },
        });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});
// POST /api/auth/register/client — create client account
router.post('/register/client', async (req, res) => {
    const parsed = registerClientSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
    }
    const { name, email, password } = parsed.data;
    try {
        const existing = await db_1.db.query.users.findFirst({
            where: (0, drizzle_orm_1.eq)(schema_1.users.email, email),
        });
        if (existing) {
            return res.status(409).json({ error: 'Email already in use' });
        }
        const passwordHash = await bcryptjs_1.default.hash(password, 12);
        const [newUser] = await db_1.db
            .insert(schema_1.users)
            .values({ name, email, passwordHash, role: 'client' })
            .returning();
        const token = generateToken(newUser.id, newUser.email, 'client');
        return res.status(201).json({
            token,
            user: { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role },
        });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});
// POST /api/auth/login — works for both roles
router.post('/login', async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
    }
    const { email, password } = parsed.data;
    try {
        const user = await db_1.db.query.users.findFirst({
            where: (0, drizzle_orm_1.eq)(schema_1.users.email, email),
            with: { business: true },
        });
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const valid = await bcryptjs_1.default.compare(password, user.passwordHash);
        if (!valid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const token = generateToken(user.id, user.email, user.role);
        return res.json({
            token,
            user: { id: user.id, name: user.name, email: user.email, role: user.role },
            business: user.business ?? null,
        });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});
// GET /api/auth/me — get current user info
router.get('/me', auth_1.authenticate, async (req, res) => {
    try {
        const user = await db_1.db.query.users.findFirst({
            where: (0, drizzle_orm_1.eq)(schema_1.users.id, req.user.userId),
            with: { business: true },
        });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        return res.json({
            user: { id: user.id, name: user.name, email: user.email, role: user.role },
            business: user.business ?? null,
        });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});
exports.default = router;
