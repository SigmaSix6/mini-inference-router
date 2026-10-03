import { getDb } from "@/lib/db/client"
import { requestAttempts, requests } from "@/lib/db/schema"
import type { AttemptRecord } from "@/lib/execute"

export async function persistRequest(input: {
  id: string
  tenantId: string
  routeRule: string
  servedBy: string | null
  fallbackFired: boolean
  promptTokens: number
  completionTokens: number
  tokensEstimated: boolean
  costUsd: number
  latencyMs: number
  ttftMs: number | null
  outcome: string
  intent: string | null
  confidence: number | null
  refused: boolean
  attempts: AttemptRecord[]
}) {
  const db = getDb()
  await db.insert(requests).values({
    id: input.id,
    tenantId: input.tenantId,
    routeRule: input.routeRule,
    servedBy: input.servedBy,
    fallbackFired: input.fallbackFired,
    promptTokens: input.promptTokens,
    completionTokens: input.completionTokens,
    tokensEstimated: input.tokensEstimated,
    costUsd: input.costUsd,
    latencyMs: input.latencyMs,
    ttftMs: input.ttftMs,
    outcome: input.outcome,
    intent: input.intent,
    confidence: input.confidence,
    refused: input.refused,
  })
  if (input.attempts.length > 0) {
    await db.insert(requestAttempts).values(
      input.attempts.map((attempt) => ({
        requestId: input.id,
        seq: attempt.seq,
        backend: attempt.backend,
        status: attempt.status,
        error: attempt.error,
        latencyMs: attempt.latencyMs,
      })),
    )
  }
}
