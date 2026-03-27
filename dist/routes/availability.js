"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const drizzle_orm_1 = require("drizzle-orm");
const zod_1 = require("zod");
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
const availabilitySchema = zod_1.z.object({
    // Array of day configs — replace all at once (simpler UX)
    slots: zod_1.z.array(zod_1.z.object({
        dayOfWeek: zod_1.z.number().int().min(0).max(6),
        startTime: zod_1.z.string().regex(/^\d{2}:\d{2}$/, 'Format HH:MM'),
        endTime: zod_1.z.string().regex(/^\d{2}:\d{2}$/, 'Format HH:MM'),
    }).refine((s) => s.startTime < s.endTime, {
        message: 'startTime must be before endTime',
    })),
});
async function getOwnerBusiness(userId) {
    return db_1.db.query.businesses.findFirst({
        where: (0, drizzle_orm_1.eq)(schema_1.businesses.ownerId, userId),
    });
}
// GET /api/availability — get current availability for owner
router.get('/', auth_1.authenticate, (0, auth_1.requireRole)('owner'), async (req, res) => {
    const business = await getOwnerBusiness(req.user.userId);
    if (!business)
        return res.status(404).json({ error: 'Business not found' });
    const result = await db_1.db.query.availabilities.findMany({
        where: (0, drizzle_orm_1.eq)(schema_1.availabilities.businessId, business.id),
        orderBy: (a, { asc }) => [asc(a.dayOfWeek)],
    });
    return res.json(result);
});
// GET /api/availability/public/:slug — public availability for booking page
router.get('/public/:slug', async (req, res) => {
    const business = await db_1.db.query.businesses.findFirst({
        where: (0, drizzle_orm_1.eq)(schema_1.businesses.slug, req.params.slug),
    });
    if (!business)
        return res.status(404).json({ error: 'Business not found' });
    const result = await db_1.db.query.availabilities.findMany({
        where: (0, drizzle_orm_1.eq)(schema_1.availabilities.businessId, business.id),
        orderBy: (a, { asc }) => [asc(a.dayOfWeek)],
    });
    return res.json(result);
});
// POST /api/availability — replace entire weekly schedule
router.post('/', auth_1.authenticate, (0, auth_1.requireRole)('owner'), async (req, res) => {
    const parsed = availabilitySchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    const business = await getOwnerBusiness(req.user.userId);
    if (!business)
        return res.status(404).json({ error: 'Business not found' });
    // Delete existing and insert new atomically — replace strategy
    await db_1.db.transaction(async (tx) => {
        await tx.delete(schema_1.availabilities).where((0, drizzle_orm_1.eq)(schema_1.availabilities.businessId, business.id));
        if (parsed.data.slots.length > 0) {
            await tx.insert(schema_1.availabilities).values(parsed.data.slots.map((slot) => ({ ...slot, businessId: business.id })));
        }
    });
    const result = await db_1.db.query.availabilities.findMany({
        where: (0, drizzle_orm_1.eq)(schema_1.availabilities.businessId, business.id),
        orderBy: (a, { asc }) => [asc(a.dayOfWeek)],
    });
    return res.json(result);
});
exports.default = router;
