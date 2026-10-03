import { boolean, doublePrecision, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core"

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  apiKeyHash: text("api_key_hash").notNull().unique(),
  plan: text("plan").notNull().default("standard"),
  quotaTokens: integer("quota_tokens").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export const requests = pgTable("requests", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  routeRule: text("route_rule").notNull(),
  servedBy: text("served_by"),
  fallbackFired: boolean("fallback_fired").notNull().default(false),
  promptTokens: integer("prompt_tokens").notNull().default(0),
  completionTokens: integer("completion_tokens").notNull().default(0),
  tokensEstimated: boolean("tokens_estimated").notNull().default(false),
  costUsd: doublePrecision("cost_usd").notNull().default(0),
  latencyMs: integer("latency_ms").notNull().default(0),
  ttftMs: integer("ttft_ms"),
  outcome: text("outcome").notNull(),
  intent: text("intent"),
  confidence: doublePrecision("confidence"),
  refused: boolean("refused").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export const requestAttempts = pgTable("request_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id")
    .notNull()
    .references(() => requests.id),
  seq: integer("seq").notNull(),
  backend: text("backend").notNull(),
  status: text("status").notNull(),
  error: text("error"),
  latencyMs: integer("latency_ms").notNull(),
})

export const quotaUsage = pgTable(
  "quota_usage",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    period: text("period").notNull(),
    usedTokens: integer("used_tokens").notNull().default(0),
    reservedTokens: integer("reserved_tokens").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.period] })],
)
