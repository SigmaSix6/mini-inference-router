CREATE TABLE IF NOT EXISTS "tenants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL UNIQUE,
  "api_key_hash" text NOT NULL UNIQUE,
  "plan" text NOT NULL DEFAULT 'standard',
  "quota_tokens" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "requests" (
  "id" uuid PRIMARY KEY,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "route_rule" text NOT NULL,
  "served_by" text,
  "fallback_fired" boolean NOT NULL DEFAULT false,
  "prompt_tokens" integer NOT NULL DEFAULT 0,
  "completion_tokens" integer NOT NULL DEFAULT 0,
  "tokens_estimated" boolean NOT NULL DEFAULT false,
  "cost_usd" double precision NOT NULL DEFAULT 0,
  "latency_ms" integer NOT NULL DEFAULT 0,
  "ttft_ms" integer,
  "outcome" text NOT NULL,
  "intent" text,
  "confidence" double precision,
  "refused" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "request_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "request_id" uuid NOT NULL REFERENCES "requests"("id"),
  "seq" integer NOT NULL,
  "backend" text NOT NULL,
  "status" text NOT NULL,
  "error" text,
  "latency_ms" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quota_usage" (
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "period" text NOT NULL,
  "used_tokens" integer NOT NULL DEFAULT 0,
  "reserved_tokens" integer NOT NULL DEFAULT 0,
  PRIMARY KEY ("tenant_id", "period")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "requests_tenant_created_idx" ON "requests" ("tenant_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "request_attempts_request_idx" ON "request_attempts" ("request_id", "seq");
