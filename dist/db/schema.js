"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bookingsRelations = exports.servicesRelations = exports.businessesRelations = exports.usersRelations = exports.stripeSubscriptions = exports.bookings = exports.availabilities = exports.services = exports.businesses = exports.users = exports.subscriptionStatusEnum = exports.bookingStatusEnum = exports.planEnum = exports.userRoleEnum = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
const drizzle_orm_1 = require("drizzle-orm");
// ─── Enums ─────────────────────────────────────────────────────────────────
exports.userRoleEnum = (0, pg_core_1.pgEnum)('user_role', ['owner', 'client']);
exports.planEnum = (0, pg_core_1.pgEnum)('plan', ['free', 'pro']);
exports.bookingStatusEnum = (0, pg_core_1.pgEnum)('booking_status', [
    'pending',
    'confirmed',
    'cancelled',
]);
exports.subscriptionStatusEnum = (0, pg_core_1.pgEnum)('subscription_status', [
    'active',
    'past_due',
    'cancelled',
    'trialing',
]);
// ─── Tables ────────────────────────────────────────────────────────────────
exports.users = (0, pg_core_1.pgTable)('users', {
    id: (0, pg_core_1.uuid)('id').defaultRandom().primaryKey(),
    name: (0, pg_core_1.varchar)('name', { length: 100 }).notNull(),
    email: (0, pg_core_1.varchar)('email', { length: 255 }).notNull().unique(),
    passwordHash: (0, pg_core_1.text)('password_hash').notNull(),
    role: (0, exports.userRoleEnum)('role').notNull().default('client'),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at').defaultNow().notNull(),
});
exports.businesses = (0, pg_core_1.pgTable)('businesses', {
    id: (0, pg_core_1.uuid)('id').defaultRandom().primaryKey(),
    ownerId: (0, pg_core_1.uuid)('owner_id')
        .notNull()
        .references(() => exports.users.id, { onDelete: 'cascade' }),
    name: (0, pg_core_1.varchar)('name', { length: 100 }).notNull(),
    slug: (0, pg_core_1.varchar)('slug', { length: 100 }).notNull().unique(),
    description: (0, pg_core_1.text)('description'),
    phone: (0, pg_core_1.varchar)('phone', { length: 20 }),
    plan: (0, exports.planEnum)('plan').notNull().default('free'),
    stripeCustomerId: (0, pg_core_1.text)('stripe_customer_id'),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at').defaultNow().notNull(),
});
exports.services = (0, pg_core_1.pgTable)('services', {
    id: (0, pg_core_1.uuid)('id').defaultRandom().primaryKey(),
    businessId: (0, pg_core_1.uuid)('business_id')
        .notNull()
        .references(() => exports.businesses.id, { onDelete: 'cascade' }),
    name: (0, pg_core_1.varchar)('name', { length: 100 }).notNull(),
    description: (0, pg_core_1.text)('description'),
    durationMinutes: (0, pg_core_1.integer)('duration_minutes').notNull().default(60),
    price: (0, pg_core_1.decimal)('price', { precision: 10, scale: 2 }).notNull().default('0'),
    active: (0, pg_core_1.boolean)('active').notNull().default(true),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
});
// day_of_week: 0 = Sunday, 1 = Monday, ..., 6 = Saturday
exports.availabilities = (0, pg_core_1.pgTable)('availabilities', {
    id: (0, pg_core_1.uuid)('id').defaultRandom().primaryKey(),
    businessId: (0, pg_core_1.uuid)('business_id')
        .notNull()
        .references(() => exports.businesses.id, { onDelete: 'cascade' }),
    dayOfWeek: (0, pg_core_1.integer)('day_of_week').notNull(), // 0-6
    startTime: (0, pg_core_1.time)('start_time').notNull(),
    endTime: (0, pg_core_1.time)('end_time').notNull(),
});
exports.bookings = (0, pg_core_1.pgTable)('bookings', {
    id: (0, pg_core_1.uuid)('id').defaultRandom().primaryKey(),
    businessId: (0, pg_core_1.uuid)('business_id')
        .notNull()
        .references(() => exports.businesses.id, { onDelete: 'cascade' }),
    serviceId: (0, pg_core_1.uuid)('service_id')
        .notNull()
        .references(() => exports.services.id, { onDelete: 'cascade' }),
    clientId: (0, pg_core_1.uuid)('client_id')
        .notNull()
        .references(() => exports.users.id, { onDelete: 'cascade' }),
    date: (0, pg_core_1.varchar)('date', { length: 10 }).notNull(), // YYYY-MM-DD
    startTime: (0, pg_core_1.time)('start_time').notNull(),
    endTime: (0, pg_core_1.time)('end_time').notNull(),
    status: (0, exports.bookingStatusEnum)('status').notNull().default('pending'),
    notes: (0, pg_core_1.text)('notes'),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at').defaultNow().notNull(),
});
exports.stripeSubscriptions = (0, pg_core_1.pgTable)('stripe_subscriptions', {
    id: (0, pg_core_1.uuid)('id').defaultRandom().primaryKey(),
    businessId: (0, pg_core_1.uuid)('business_id')
        .notNull()
        .references(() => exports.businesses.id, { onDelete: 'cascade' }),
    stripeSubscriptionId: (0, pg_core_1.text)('stripe_subscription_id').notNull().unique(),
    status: (0, exports.subscriptionStatusEnum)('status').notNull(),
    currentPeriodEnd: (0, pg_core_1.timestamp)('current_period_end').notNull(),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at').defaultNow().notNull(),
});
// ─── Relations ─────────────────────────────────────────────────────────────
exports.usersRelations = (0, drizzle_orm_1.relations)(exports.users, ({ many, one }) => ({
    business: one(exports.businesses, {
        fields: [exports.users.id],
        references: [exports.businesses.ownerId],
    }),
    bookings: many(exports.bookings),
}));
exports.businessesRelations = (0, drizzle_orm_1.relations)(exports.businesses, ({ one, many }) => ({
    owner: one(exports.users, {
        fields: [exports.businesses.ownerId],
        references: [exports.users.id],
    }),
    services: many(exports.services),
    availabilities: many(exports.availabilities),
    bookings: many(exports.bookings),
    subscription: one(exports.stripeSubscriptions, {
        fields: [exports.businesses.id],
        references: [exports.stripeSubscriptions.businessId],
    }),
}));
exports.servicesRelations = (0, drizzle_orm_1.relations)(exports.services, ({ one, many }) => ({
    business: one(exports.businesses, {
        fields: [exports.services.businessId],
        references: [exports.businesses.id],
    }),
    bookings: many(exports.bookings),
}));
exports.bookingsRelations = (0, drizzle_orm_1.relations)(exports.bookings, ({ one }) => ({
    business: one(exports.businesses, {
        fields: [exports.bookings.businessId],
        references: [exports.businesses.id],
    }),
    service: one(exports.services, {
        fields: [exports.bookings.serviceId],
        references: [exports.services.id],
    }),
    client: one(exports.users, {
        fields: [exports.bookings.clientId],
        references: [exports.users.id],
    }),
}));
