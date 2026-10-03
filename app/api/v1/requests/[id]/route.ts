import { asc, eq } from "drizzle-orm"
import { getDb } from "@/lib/db/client"
import { requestAttempts, requests, tenants } from "@/lib/db/schema"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return Response.json({ error: "not_found", message: "Unknown request." }, { status: 404 })
  }
  try {
    const db = getDb()
    const [row] = await db.select().from(requests).where(eq(requests.id, id)).limit(1)
    if (!row) {
      return Response.json({ error: "not_found", message: "Unknown request." }, { status: 404 })
    }
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, row.tenantId)).limit(1)
    const attempts = await db
      .select()
      .from(requestAttempts)
      .where(eq(requestAttempts.requestId, id))
      .orderBy(asc(requestAttempts.seq))
    return Response.json({
      id: row.id,
      tenant: tenant?.name ?? null,
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
      attempts: attempts.map((attempt) => ({
        seq: attempt.seq,
        backend: attempt.backend,
        status: attempt.status,
        error: attempt.error,
        latencyMs: attempt.latencyMs,
      })),
    })
  } catch {
    return Response.json(
      { error: "request_unavailable", message: "Request store is unavailable." },
      { status: 503 },
    )
  }
}
