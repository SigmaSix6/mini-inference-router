import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm"
import type { UsageResponse, UsageTenant } from "@/lib/api-types"
import { getDb } from "@/lib/db/client"
import { quotaUsage, requestAttempts, requests, tenants } from "@/lib/db/schema"
import { resetsAtIso, utcPeriod } from "@/lib/period"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const period = utcPeriod()
    const start = new Date(`${period}T00:00:00.000Z`)
    const end = new Date(resetsAtIso(period))
    const db = getDb()
    const tenantRows = await db.select().from(tenants).orderBy(tenants.name)
    const usageRows = await db.select().from(quotaUsage).where(eq(quotaUsage.period, period))
    const requestRows = await db
      .select()
      .from(requests)
      .where(and(gte(requests.createdAt, start), lt(requests.createdAt, end)))
      .orderBy(desc(requests.createdAt))
    const ids = requestRows.map((row) => row.id)
    const attemptRows =
      ids.length === 0
        ? []
        : await db
            .select()
            .from(requestAttempts)
            .where(inArray(requestAttempts.requestId, ids))
            .orderBy(asc(requestAttempts.seq))

    const usageByTenant = new Map(usageRows.map((row) => [row.tenantId, row]))
    const attemptsByRequest = new Map<string, typeof attemptRows>()
    for (const attempt of attemptRows) {
      const list = attemptsByRequest.get(attempt.requestId) ?? []
      list.push(attempt)
      attemptsByRequest.set(attempt.requestId, list)
    }

    const payload: UsageResponse = {
      period,
      resetsAt: end.toISOString(),
      tenants: tenantRows.map((tenant): UsageTenant => {
        const usage = usageByTenant.get(tenant.id)
        const usedTokens = usage?.usedTokens ?? 0
        const reservedTokens = usage?.reservedTokens ?? 0
        const mine = requestRows.filter((row) => row.tenantId === tenant.id)
        return {
          id: tenant.id,
          name: tenant.name,
          plan: tenant.plan,
          quotaTokens: tenant.quotaTokens,
          usedTokens,
          reservedTokens,
          remainingTokens: Math.max(0, tenant.quotaTokens - usedTokens - reservedTokens),
          requests: mine.length,
          costUsd: round8(mine.reduce((sum, row) => sum + row.costUsd, 0)),
          recent: mine.slice(0, 20).map((row) => ({
            id: row.id,
            createdAt: row.createdAt.toISOString(),
            routeRule: row.routeRule,
            servedBy: row.servedBy,
            fallbackFired: row.fallbackFired,
            promptTokens: row.promptTokens,
            completionTokens: row.completionTokens,
            tokensEstimated: row.tokensEstimated,
            costUsd: row.costUsd,
            latencyMs: row.latencyMs,
            ttftMs: row.ttftMs,
            outcome: row.outcome,
            intent: row.intent,
            confidence: row.confidence,
            refused: row.refused,
            attempts: (attemptsByRequest.get(row.id) ?? []).map((attempt) => ({
              seq: attempt.seq,
              backend: attempt.backend,
              status: attempt.status as "ok" | "error" | "timeout" | "unusable",
              error: attempt.error,
              latencyMs: attempt.latencyMs,
            })),
          })),
        }
      }),
    }
    return Response.json(payload)
  } catch {
    return Response.json(
      { error: "usage_unavailable", message: "Usage store is unavailable." },
      { status: 503 },
    )
  }
}

function round8(value: number) {
  return Math.round(value * 1e8) / 1e8
}
