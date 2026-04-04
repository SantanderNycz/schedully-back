"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.webhookHandler = webhookHandler;
const express_1 = require("express");
const stripe_1 = __importDefault(require("stripe"));
const drizzle_orm_1 = require("drizzle-orm");
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// Lazy init — only instantiated when a route is actually called
function getStripe() {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key || key === "sk_test_placeholder") {
        throw new Error("Stripe is not configured. Set STRIPE_SECRET_KEY in environment variables.");
    }
    return new stripe_1.default(key);
}
// ─── Helpers ───────────────────────────────────────────────────────────────
async function getOwnerBusiness(userId) {
    return db_1.db.query.businesses.findFirst({
        where: (0, drizzle_orm_1.eq)(schema_1.businesses.ownerId, userId),
    });
}
function getPeriodEnd(sub) {
    const item = sub.items.data[0];
    if (item?.current_period_end) {
        return new Date(item.current_period_end * 1000);
    }
    return new Date(sub.billing_cycle_anchor * 1000);
}
// ─── POST /api/billing/create-checkout-session ─────────────────────────────
router.post("/create-checkout-session", auth_1.authenticate, (0, auth_1.requireRole)("owner"), async (req, res) => {
    try {
        const stripe = getStripe();
        const business = await getOwnerBusiness(req.user.userId);
        if (!business)
            return res.status(404).json({ error: "Business not found" });
        if (business.plan === "pro")
            return res.status(400).json({ error: "Already on Pro plan" });
        let customerId = business.stripeCustomerId;
        if (!customerId) {
            const customer = await stripe.customers.create({
                email: req.user.email,
                metadata: { businessId: business.id },
            });
            customerId = customer.id;
            await db_1.db
                .update(schema_1.businesses)
                .set({ stripeCustomerId: customerId })
                .where((0, drizzle_orm_1.eq)(schema_1.businesses.id, business.id));
        }
        const session = await stripe.checkout.sessions.create({
            customer: customerId,
            mode: "subscription",
            line_items: [{ price: process.env.STRIPE_PRO_PRICE_ID, quantity: 1 }],
            success_url: `${process.env.CLIENT_URL || "http://localhost:5173"}/dashboard?billing=success`,
            cancel_url: `${process.env.CLIENT_URL || "http://localhost:5173"}/dashboard?billing=cancelled`,
            metadata: { businessId: business.id },
        });
        return res.json({ url: session.url });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Internal server error" });
    }
});
// ─── POST /api/billing/portal ──────────────────────────────────────────────
router.post("/portal", auth_1.authenticate, (0, auth_1.requireRole)("owner"), async (req, res) => {
    try {
        const stripe = getStripe();
        const business = await getOwnerBusiness(req.user.userId);
        if (!business?.stripeCustomerId) {
            return res.status(400).json({ error: "No billing account found" });
        }
        const session = await stripe.billingPortal.sessions.create({
            customer: business.stripeCustomerId,
            return_url: `${process.env.CLIENT_URL || "http://localhost:5173"}/dashboard`,
        });
        return res.json({ url: session.url });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Internal server error" });
    }
});
exports.default = router;
// ─── Webhook handler (exported separately — needs raw body) ────────────────
async function webhookHandler(req, res) {
    const stripe = getStripe();
    const sig = req.headers["stripe-signature"];
    if (!sig)
        return res.status(400).json({ error: "Missing stripe-signature header" });
    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    }
    catch (err) {
        console.error("Webhook signature verification failed:", err);
        return res.status(400).json({ error: "Invalid webhook signature" });
    }
    try {
        switch (event.type) {
            case "customer.subscription.created":
            case "customer.subscription.updated": {
                const sub = event.data.object;
                const customerId = sub.customer;
                const business = await db_1.db.query.businesses.findFirst({
                    where: (0, drizzle_orm_1.eq)(schema_1.businesses.stripeCustomerId, customerId),
                });
                if (!business)
                    break;
                const status = sub.status;
                const periodEnd = getPeriodEnd(sub);
                await db_1.db
                    .insert(schema_1.stripeSubscriptions)
                    .values({
                    businessId: business.id,
                    stripeSubscriptionId: sub.id,
                    status,
                    currentPeriodEnd: periodEnd,
                })
                    .onConflictDoUpdate({
                    target: schema_1.stripeSubscriptions.stripeSubscriptionId,
                    set: { status, currentPeriodEnd: periodEnd, updatedAt: new Date() },
                });
                const newPlan = ["active", "trialing"].includes(status)
                    ? "pro"
                    : "free";
                await db_1.db
                    .update(schema_1.businesses)
                    .set({ plan: newPlan, updatedAt: new Date() })
                    .where((0, drizzle_orm_1.eq)(schema_1.businesses.id, business.id));
                break;
            }
            case "customer.subscription.deleted": {
                const sub = event.data.object;
                const customerId = sub.customer;
                const business = await db_1.db.query.businesses.findFirst({
                    where: (0, drizzle_orm_1.eq)(schema_1.businesses.stripeCustomerId, customerId),
                });
                if (!business)
                    break;
                await db_1.db
                    .update(schema_1.stripeSubscriptions)
                    .set({ status: "cancelled", updatedAt: new Date() })
                    .where((0, drizzle_orm_1.eq)(schema_1.stripeSubscriptions.stripeSubscriptionId, sub.id));
                await db_1.db
                    .update(schema_1.businesses)
                    .set({ plan: "free", updatedAt: new Date() })
                    .where((0, drizzle_orm_1.eq)(schema_1.businesses.id, business.id));
                break;
            }
        }
    }
    catch (err) {
        console.error("Webhook processing error:", err);
        return res.status(500).json({ error: "Webhook processing failed" });
    }
    return res.json({ received: true });
}
