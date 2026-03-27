import { Router, Request, Response } from "express";
import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { businesses, stripeSubscriptions } from "../db/schema";
import { authenticate, requireRole } from "../middleware/auth";

const router = Router();

// Lazy init — only instantiated when a route is actually called
function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || key === "sk_test_placeholder") {
    throw new Error(
      "Stripe is not configured. Set STRIPE_SECRET_KEY in environment variables.",
    );
  }
  return new Stripe(key);
}

// ─── Helpers ───────────────────────────────────────────────────────────────

async function getOwnerBusiness(userId: string) {
  return db.query.businesses.findFirst({
    where: eq(businesses.ownerId, userId),
  });
}

function getPeriodEnd(sub: Stripe.Subscription): Date {
  const item = sub.items.data[0];
  if (item?.current_period_end) {
    return new Date(item.current_period_end * 1000);
  }
  return new Date(sub.billing_cycle_anchor * 1000);
}

// ─── POST /api/billing/create-checkout-session ─────────────────────────────

router.post(
  "/create-checkout-session",
  authenticate,
  requireRole("owner"),
  async (req: Request, res: Response) => {
    try {
      const stripe = getStripe();
      const business = await getOwnerBusiness(req.user!.userId);
      if (!business)
        return res.status(404).json({ error: "Business not found" });
      if (business.plan === "pro")
        return res.status(400).json({ error: "Already on Pro plan" });

      let customerId = business.stripeCustomerId;

      if (!customerId) {
        const customer = await stripe.customers.create({
          email: req.user!.email,
          metadata: { businessId: business.id },
        });
        customerId = customer.id;
        await db
          .update(businesses)
          .set({ stripeCustomerId: customerId })
          .where(eq(businesses.id, business.id));
      }

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "subscription",
        line_items: [{ price: process.env.STRIPE_PRO_PRICE_ID!, quantity: 1 }],
        success_url: `${process.env.CLIENT_URL || "http://localhost:5173"}/dashboard?billing=success`,
        cancel_url: `${process.env.CLIENT_URL || "http://localhost:5173"}/dashboard?billing=cancelled`,
        metadata: { businessId: business.id },
      });

      return res.json({ url: session.url });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ─── POST /api/billing/portal ──────────────────────────────────────────────

router.post(
  "/portal",
  authenticate,
  requireRole("owner"),
  async (req: Request, res: Response) => {
    try {
      const stripe = getStripe();
      const business = await getOwnerBusiness(req.user!.userId);
      if (!business?.stripeCustomerId) {
        return res.status(400).json({ error: "No billing account found" });
      }

      const session = await stripe.billingPortal.sessions.create({
        customer: business.stripeCustomerId,
        return_url: `${process.env.CLIENT_URL || "http://localhost:5173"}/dashboard`,
      });

      return res.json({ url: session.url });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;

// ─── Webhook handler (exported separately — needs raw body) ────────────────

export async function webhookHandler(req: Request, res: Response) {
  const stripe = getStripe();
  const sig = req.headers["stripe-signature"];
  if (!sig)
    return res.status(400).json({ error: "Missing stripe-signature header" });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!,
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return res.status(400).json({ error: "Invalid webhook signature" });
  }

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;

        const business = await db.query.businesses.findFirst({
          where: eq(businesses.stripeCustomerId, customerId),
        });
        if (!business) break;

        const status = sub.status as
          | "active"
          | "past_due"
          | "cancelled"
          | "trialing";
        const periodEnd = getPeriodEnd(sub);

        await db
          .insert(stripeSubscriptions)
          .values({
            businessId: business.id,
            stripeSubscriptionId: sub.id,
            status,
            currentPeriodEnd: periodEnd,
          })
          .onConflictDoUpdate({
            target: stripeSubscriptions.stripeSubscriptionId,
            set: { status, currentPeriodEnd: periodEnd, updatedAt: new Date() },
          });

        const newPlan = ["active", "trialing"].includes(status)
          ? "pro"
          : "free";
        await db
          .update(businesses)
          .set({ plan: newPlan, updatedAt: new Date() })
          .where(eq(businesses.id, business.id));

        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;

        const business = await db.query.businesses.findFirst({
          where: eq(businesses.stripeCustomerId, customerId),
        });
        if (!business) break;

        await db
          .update(stripeSubscriptions)
          .set({ status: "cancelled", updatedAt: new Date() })
          .where(eq(stripeSubscriptions.stripeSubscriptionId, sub.id));

        await db
          .update(businesses)
          .set({ plan: "free", updatedAt: new Date() })
          .where(eq(businesses.id, business.id));

        break;
      }
    }
  } catch (err) {
    console.error("Webhook processing error:", err);
    return res.status(500).json({ error: "Webhook processing failed" });
  }

  return res.json({ received: true });
}
