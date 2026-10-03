import { randomUUID } from "node:crypto"
import { findTenantByKey } from "@/lib/auth"
import type { DoneEvent, MetaEvent } from "@/lib/api-types"
import { getBackends } from "@/lib/backends/registry"
import { finalConfidence, preConfidence } from "@/lib/confidence"
import { estimateCost } from "@/lib/cost"
import { createDbQuotaStore } from "@/lib/db/quota-store"
import { executeWithFallback } from "@/lib/execute"
import { REFUSAL_TEXT } from "@/lib/intents"
import { persistRequest } from "@/lib/persist"
import { buildPrompt } from "@/lib/prompt"
import { reserveQuota } from "@/lib/quota"
import { utcPeriod } from "@/lib/period"
import { searchKb } from "@/lib/retrieval/kb"
import { buildChain, chooseRoute } from "@/lib/routing"
import type { ChatBody } from "@/lib/chat-schema"
import { estimateTokens, reservationEstimate } from "@/lib/tokens"

const encoder = new TextEncoder()

function encode(event: string, data: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

export async function openSupportChat(input: {
  apiKey: string
  message: string
  debug?: ChatBody["debug"]
}): Promise<
  | { kind: "json"; status: number; body: unknown }
  | { kind: "sse"; stream: ReadableStream<Uint8Array> }
> {
  const started = Date.now()
  const lookup = await findTenantByKey(input.apiKey)
  if (!lookup.ok) {
    return {
      kind: "json",
      status: 503,
      body: {
        error: "quota_unavailable",
        message: "Auth store is unavailable. The request was denied.",
      },
    }
  }
  if (!lookup.tenant) {
    return {
      kind: "json",
      status: 401,
      body: { error: "unauthorized", message: "Unknown API key." },
    }
  }

  const tenant = lookup.tenant
  const period = utcPeriod()
  const estimate = reservationEstimate(input.message)
  const store = createDbQuotaStore()
  const quota = await reserveQuota(store, {
    tenantId: tenant.id,
    period,
    estimate,
    limit: tenant.quotaTokens,
  })
  if (!quota.ok) return { kind: "json", status: quota.status, body: quota.body }

  const requestId = randomUUID()
  let actual = estimateTokens(input.message)

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      const send = (event: string, data: unknown) => {
        if (closed) return
        try {
          controller.enqueue(encode(event, data))
        } catch {
          closed = true
        }
      }
      try {
        const hits = searchKb(input.message, 5)
        const pre = preConfidence(hits)
        const route = chooseRoute({
          plan: tenant.plan,
          message: input.message,
          voteShare: pre.voteShare,
          margin: pre.margin,
          forceTier: input.debug?.forceTier,
        })
        const chain = buildChain(getBackends(), route.tier)
        const routeRule = pre.refuse ? "refuse_low_confidence" : route.rule
        const meta: MetaEvent = {
          requestId,
          routeRule,
          chain: chain.map((backend) => backend.id),
          primary: chain[0]?.id ?? null,
          retrieved: hits.map((hit) => ({
            id: hit.id,
            intent: hit.intent,
            instruction: hit.instruction,
            score: Number(hit.score.toFixed(3)),
          })),
          knnIntent: pre.intent,
          preConfidence: round3(pre.score),
          preBand: pre.band,
        }
        send("meta", meta)

        if (pre.refuse) {
          const answer = REFUSAL_TEXT
          actual = estimateTokens(input.message) + estimateTokens(answer)
          send("token", { text: answer })
          const done = await finish({
            requestId,
            tenantId: tenant.id,
            routeRule,
            servedBy: null,
            model: null,
            fallbackFired: false,
            degraded: false,
            intent: pre.intent,
            confidence: pre.score,
            confidenceBand: pre.band,
            refused: true,
            outcome: "refused",
            promptTokens: estimateTokens(input.message),
            completionTokens: estimateTokens(answer),
            tokensEstimated: true,
            costUsd: 0,
            latencyMs: Date.now() - started,
            ttftMs: Date.now() - started,
            attempts: [],
            fallbacks: [],
            answer,
          })
          send("done", done)
          return
        }

        const prompt = buildPrompt(input.message, hits)
        const execution = await executeWithFallback({
          chain,
          knnIntent: pre.intent,
          primaryMode: input.debug?.primaryMode,
          request: {
            system: prompt.system,
            user: prompt.user,
            knnIntent: pre.intent ?? "",
            retrieved: hits,
            debug: { tokenDelayMs: input.debug?.tokenDelayMs },
          },
          onToken: (text) => send("token", { text }),
          onReset: () => send("reset", {}),
          onFallback: (event) => send("fallback", event),
        })

        let outcome: string = execution.outcome
        let refused = false
        let intent = execution.assessment?.intent ?? pre.intent
        let confidence = pre.score
        let band: string | null = pre.band
        let answer = execution.assessment?.answer ?? ""
        let degraded = execution.degraded

        if (!execution.assessment) {
          refused = outcome === "unusable"
          answer = refused
            ? REFUSAL_TEXT
            : "Every model backend failed before a usable answer was produced."
          send("reset", {})
          send("token", { text: answer })
          intent = pre.intent
        } else {
          const final = finalConfidence({
            preScore: pre.score,
            voteShare: pre.voteShare,
            llmIntent: execution.assessment.usedKnnIntent ? null : execution.assessment.intent,
            knnIntent: pre.intent,
            usedKnnIntent: execution.assessment.usedKnnIntent,
          })
          confidence = final.score
          band = final.band
          if (execution.assessment.declined || final.refuse) {
            refused = true
            outcome = "refused"
            degraded = false
            answer = REFUSAL_TEXT
            send("reset", {})
            send("token", { text: answer })
          }
        }

        actual = execution.promptTokens + execution.completionTokens
        const costUsd = execution.model
          ? estimateCost(execution.model, execution.promptTokens, execution.completionTokens)
          : 0
        const done = await finish({
          requestId,
          tenantId: tenant.id,
          routeRule,
          servedBy: execution.servedBy,
          model: execution.model,
          fallbackFired: execution.fallbackFired,
          degraded,
          intent,
          confidence,
          confidenceBand: band,
          refused,
          outcome,
          promptTokens: execution.promptTokens,
          completionTokens: execution.completionTokens,
          tokensEstimated: execution.tokensEstimated,
          costUsd,
          latencyMs: Date.now() - started,
          ttftMs: execution.ttftMs,
          attempts: execution.attempts,
          fallbacks: execution.fallbacks,
          answer,
        })
        send("done", done)
      } catch (error) {
        send("error", {
          message: error instanceof Error ? error.message : "The request failed.",
        })
      } finally {
        try {
          await store.settle({ tenantId: tenant.id, period, actual, reserved: estimate })
        } catch (error) {
          console.error("quota settle failed", error)
        }
        if (!closed) {
          try {
            controller.close()
          } catch {
            closed = true
          }
        }
      }
    },
  })

  return { kind: "sse", stream }
}

async function finish(input: {
  requestId: string
  tenantId: string
  routeRule: string
  servedBy: string | null
  model: string | null
  fallbackFired: boolean
  degraded: boolean
  intent: string | null
  confidence: number
  confidenceBand: string | null
  refused: boolean
  outcome: string
  promptTokens: number
  completionTokens: number
  tokensEstimated: boolean
  costUsd: number
  latencyMs: number
  ttftMs: number | null
  attempts: DoneEvent["attempts"]
  fallbacks: DoneEvent["fallbacks"]
  answer: string
}): Promise<DoneEvent> {
  const done: DoneEvent = {
    requestId: input.requestId,
    servedBy: input.servedBy,
    model: input.model,
    fallbackFired: input.fallbackFired,
    degraded: input.degraded,
    intent: input.intent,
    confidence: round3(input.confidence),
    confidenceBand: input.confidenceBand,
    refused: input.refused,
    outcome: input.outcome,
    promptTokens: input.promptTokens,
    completionTokens: input.completionTokens,
    tokensEstimated: input.tokensEstimated,
    costUsd: input.costUsd,
    latencyMs: input.latencyMs,
    ttftMs: input.ttftMs,
    attempts: input.attempts,
    fallbacks: input.fallbacks,
    answer: input.answer,
    routeRule: input.routeRule,
  }
  await persistRequest({
    id: input.requestId,
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
    confidence: done.confidence,
    refused: input.refused,
    attempts: input.attempts,
  })
  return done
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}
