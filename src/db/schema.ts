import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  boolean,
  pgEnum,
  varchar,
  decimal,
  time,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ─── Enums ─────────────────────────────────────────────────────────────────

export const userRoleEnum = pgEnum('user_role', ['owner', 'client']);
export const planEnum = pgEnum('plan', ['free', 'pro']);
export const bookingStatusEnum = pgEnum('booking_status', [
  'pending',
  'confirmed',
  'cancelled',
]);
export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'active',
  'past_due',
  'cancelled',
  'trialing',
]);

// ─── Tables ────────────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: userRoleEnum('role').notNull().default('client'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const businesses = pgTable('businesses', {
  id: uuid('id').defaultRandom().primaryKey(),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  description: text('description'),
  phone: varchar('phone', { length: 20 }),
  plan: planEnum('plan').notNull().default('free'),
  stripeCustomerId: text('stripe_customer_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const services = pgTable('services', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description'),
  durationMinutes: integer('duration_minutes').notNull().default(60),
  price: decimal('price', { precision: 10, scale: 2 }).notNull().default('0'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// day_of_week: 0 = Sunday, 1 = Monday, ..., 6 = Saturday
export const availabilities = pgTable('availabilities', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id, { onDelete: 'cascade' }),
  dayOfWeek: integer('day_of_week').notNull(), // 0-6
  startTime: time('start_time').notNull(),
  endTime: time('end_time').notNull(),
});

export const bookings = pgTable('bookings', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id, { onDelete: 'cascade' }),
  serviceId: uuid('service_id')
    .notNull()
    .references(() => services.id, { onDelete: 'cascade' }),
  clientId: uuid('client_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  date: varchar('date', { length: 10 }).notNull(), // YYYY-MM-DD
  startTime: time('start_time').notNull(),
  endTime: time('end_time').notNull(),
  status: bookingStatusEnum('status').notNull().default('pending'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const stripeSubscriptions = pgTable('stripe_subscriptions', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id, { onDelete: 'cascade' }),
  stripeSubscriptionId: text('stripe_subscription_id').notNull().unique(),
  status: subscriptionStatusEnum('status').notNull(),
  currentPeriodEnd: timestamp('current_period_end').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── Relations ─────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ many, one }) => ({
  business: one(businesses, {
    fields: [users.id],
    references: [businesses.ownerId],
  }),
  bookings: many(bookings),
}));

export const businessesRelations = relations(businesses, ({ one, many }) => ({
  owner: one(users, {
    fields: [businesses.ownerId],
    references: [users.id],
  }),
  services: many(services),
  availabilities: many(availabilities),
  bookings: many(bookings),
  subscription: one(stripeSubscriptions, {
    fields: [businesses.id],
    references: [stripeSubscriptions.businessId],
  }),
}));

export const servicesRelations = relations(services, ({ one, many }) => ({
  business: one(businesses, {
    fields: [services.businessId],
    references: [businesses.id],
  }),
  bookings: many(bookings),
}));

export const bookingsRelations = relations(bookings, ({ one }) => ({
  business: one(businesses, {
    fields: [bookings.businessId],
    references: [businesses.id],
  }),
  service: one(services, {
    fields: [bookings.serviceId],
    references: [services.id],
  }),
  client: one(users, {
    fields: [bookings.clientId],
    references: [users.id],
  }),
}));
