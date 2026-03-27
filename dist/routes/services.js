"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const drizzle_orm_1 = require("drizzle-orm");
const zod_1 = require("zod");
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
const serviceSchema = zod_1.z.object({
    name: zod_1.z.string().min(2).max(100),
    description: zod_1.z.string().optional(),
    durationMinutes: zod_1.z.number().int().min(15).max(480),
    price: zod_1.z.string().regex(/^\d+(\.\d{1,2})?$/, 'Invalid price format'),
});
// Helper — get the business owned by the current user
async function getOwnerBusiness(userId) {
    return db_1.db.query.businesses.findFirst({
        where: (0, drizzle_orm_1.eq)(schema_1.businesses.ownerId, userId),
    });
}
// GET /api/services — list services for the authenticated owner's business
router.get('/', auth_1.authenticate, (0, auth_1.requireRole)('owner'), async (req, res) => {
    const business = await getOwnerBusiness(req.user.userId);
    if (!business)
        return res.status(404).json({ error: 'Business not found' });
    const result = await db_1.db.query.services.findMany({
        where: (0, drizzle_orm_1.eq)(schema_1.services.businessId, business.id),
        orderBy: (s, { asc }) => [asc(s.name)],
    });
    return res.json(result);
});
// GET /api/services/public/:slug — public list for booking page (no auth)
router.get('/public/:slug', async (req, res) => {
    const business = await db_1.db.query.businesses.findFirst({
        where: (0, drizzle_orm_1.eq)(schema_1.businesses.slug, req.params.slug),
    });
    if (!business)
        return res.status(404).json({ error: 'Business not found' });
    const result = await db_1.db.query.services.findMany({
        where: (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.services.businessId, business.id), (0, drizzle_orm_1.eq)(schema_1.services.active, true)),
        orderBy: (s, { asc }) => [asc(s.name)],
    });
    return res.json({ business, services: result });
});
// POST /api/services — create a service
router.post('/', auth_1.authenticate, (0, auth_1.requireRole)('owner'), async (req, res) => {
    const parsed = serviceSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    const business = await getOwnerBusiness(req.user.userId);
    if (!business)
        return res.status(404).json({ error: 'Business not found' });
    const [service] = await db_1.db
        .insert(schema_1.services)
        .values({ ...parsed.data, businessId: business.id })
        .returning();
    return res.status(201).json(service);
});
// PUT /api/services/:id — update a service
router.put('/:id', auth_1.authenticate, (0, auth_1.requireRole)('owner'), async (req, res) => {
    const parsed = serviceSchema.partial().safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    const business = await getOwnerBusiness(req.user.userId);
    if (!business)
        return res.status(404).json({ error: 'Business not found' });
    const [updated] = await db_1.db
        .update(schema_1.services)
        .set({ ...parsed.data, })
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.services.id, req.params.id), (0, drizzle_orm_1.eq)(schema_1.services.businessId, business.id)))
        .returning();
    if (!updated)
        return res.status(404).json({ error: 'Service not found' });
    return res.json(updated);
});
// DELETE /api/services/:id — soft delete (set active = false)
router.delete('/:id', auth_1.authenticate, (0, auth_1.requireRole)('owner'), async (req, res) => {
    const business = await getOwnerBusiness(req.user.userId);
    if (!business)
        return res.status(404).json({ error: 'Business not found' });
    const [updated] = await db_1.db
        .update(schema_1.services)
        .set({ active: false })
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.services.id, req.params.id), (0, drizzle_orm_1.eq)(schema_1.services.businessId, business.id)))
        .returning();
    if (!updated)
        return res.status(404).json({ error: 'Service not found' });
    return res.json({ success: true });
});
exports.default = router;
