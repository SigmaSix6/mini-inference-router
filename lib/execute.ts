import type { Backend, BackendRequest, PrimaryMode } from "@/lib/backends/types"
import { assessOutput, type OutputAssessment } from "@/lib/parse-model"
import { isAbortError, sleep } from "@/lib/sleep"
import { estimateTokens } from "@/lib/tokens"

export type AttemptStatus = "ok" | "error" | "timeout" | "unusable"

export type AttemptRecord = {
  seq: number
  backend: string
  status: AttemptStatus
  error: string | null
  latencyMs: number
}

export type FallbackEvent = {
  from: string
  to: string
  reason: string
}

export type Execution = {
  servedBy: string | null
  model: string | null
  degraded: boolean
  fallbackFired: boolean
  assessment: OutputAssessment | null
  promptTokens: number
  completionTokens: number
  tokensEstimated: boolean
  ttftMs: number | null
  attempts: AttemptRecord[]
  fallbacks: FallbackEvent[]
  outcome: "ok" | "degraded" | "unusable" | "error"
}

const DEFAULT_TTFT_MS = 3000
const DEFAULT_TOTAL_MS = 12000

export async function executeWithFallback(options: {
  chain: Backend[]
  request: BackendRequest
  knnIntent: string | null
  ttftMs?: number
  totalMs?: number
  primaryMode?: PrimaryMode
  onToken?: (text: string) => void
  onReset?: () => void
  onFallback?: (event: FallbackEvent) => void
}): Promise<Execution> {
  const ttftMs = options.ttftMs ?? DEFAULT_TTFT_MS
  const totalMs = options.totalMs ?? DEFAULT_TOTAL_MS
  const attempts: AttemptRecord[] = []
  const fallbacks: FallbackEvent[] = []

  for (let index = 0; index < options.chain.length; index += 1) {
    const backend = options.chain[index]
    const mode: PrimaryMode = index === 0 ? (options.primaryMode ?? "ok") : "ok"
    const started = Date.now()

    if (mode === "error") {
      attempts.push({
        seq: index + 1,
        backend: backend.id,
        status: "error",
        error: "injected upstream error",
        latencyMs: Date.now() - started,
      })
      noteFallback(options, fallbacks, backend.id, options.chain[index + 1]?.id, "error")
      continue
    }

    if (mode === "garbage") {
      const assessment = assessOutput("??? @@ ##", options.knnIntent)
      attempts.push({
        seq: index + 1,
        backend: backend.id,
        status: "unusable",
        error: assessment.reason,
        latencyMs: Date.now() - started,
      })
      noteFallback(options, fallbacks, backend.id, options.chain[index + 1]?.id, "unusable output")
      continue
    }

    if (mode === "hang") {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), ttftMs)
      try {
        await sleep(60_000, controller.signal)
      } catch {
        // TTFT deadline
      }
      clearTimeout(timer)
      attempts.push({
        seq: index + 1,
        backend: backend.id,
        status: "timeout",
        error: "ttft timeout",
        latencyMs: Date.now() - started,
      })
      noteFallback(options, fallbacks, backend.id, options.chain[index + 1]?.id, "ttft timeout")
      continue
    }

    const result = await readBackend(backend, options.request, ttftMs, totalMs, options.onToken)
    if (result.status !== "ok") {
      if (result.forwarded) options.onReset?.()
      attempts.push({
        seq: index + 1,
        backend: backend.id,
        status: result.status,
        error: result.error,
        latencyMs: result.latencyMs,
      })
      noteFallback(
        options,
        fallbacks,
        backend.id,
        options.chain[index + 1]?.id,
        result.status === "timeout" ? (result.error ?? "timeout") : "error",
      )
      continue
    }

    const assessment = assessOutput(result.raw, options.knnIntent)
    if (!assessment.usable) {
      if (result.forwarded) options.onReset?.()
      attempts.push({
        seq: index + 1,
        backend: backend.id,
        status: "unusable",
        error: assessment.reason,
        latencyMs: result.latencyMs,
      })
      noteFallback(options, fallbacks, backend.id, options.chain[index + 1]?.id, "unusable output")
      continue
    }

    if (!result.headerDone && assessment.answer) {
      options.onToken?.(assessment.answer)
    }

    const promptTokens = result.gotUsage
      ? result.promptTokens
      : estimateTokens(options.request.system + options.request.user)
    const completionTokens = result.gotUsage ? result.completionTokens : estimateTokens(assessment.answer)

    attempts.push({
      seq: index + 1,
      backend: backend.id,
      status: "ok",
      error: null,
      latencyMs: result.latencyMs,
    })

    return {
      servedBy: backend.id,
      model: backend.model,
      degraded: backend.degraded,
      fallbackFired: index > 0,
      assessment,
      promptTokens,
      completionTokens,
      tokensEstimated: result.gotUsage ? result.usageEstimated : true,
      ttftMs: result.ttftMs,
      attempts,
      fallbacks,
      outcome: backend.degraded ? "degraded" : "ok",
    }
  }

  const allUnusable = attempts.length > 0 && attempts.every((attempt) => attempt.status === "unusable")
  return {
    servedBy: null,
    model: null,
    degraded: false,
    fallbackFired: attempts.length > 1,
    assessment: null,
    promptTokens: estimateTokens(options.request.user),
    completionTokens: 0,
    tokensEstimated: true,
    ttftMs: null,
    attempts,
    fallbacks,
    outcome: allUnusable ? "unusable" : "error",
  }
}

function noteFallback(
  options: { onFallback?: (event: FallbackEvent) => void },
  fallbacks: FallbackEvent[],
  from: string,
  to: string | undefined,
  reason: string,
) {
  if (!to) return
  const event = { from, to, reason }
  fallbacks.push(event)
  options.onFallback?.(event)
}

async function readBackend(
  backend: Backend,
  request: BackendRequest,
  ttftMs: number,
  totalMs: number,
  onToken?: (text: string) => void,
): Promise<{
  status: "ok" | "error" | "timeout"
  error: string | null
  raw: string
  forwarded: boolean
  headerDone: boolean
  latencyMs: number
  ttftMs: number | null
  promptTokens: number
  completionTokens: number
  gotUsage: boolean
  usageEstimated: boolean
}> {
  const controller = new AbortController()
  const started = Date.now()
  let sawToken = false
  let raw = ""
  let pending = ""
  let headerDone = false
  let forwarded = false
  let promptTokens = 0
  let completionTokens = 0
  let gotUsage = false
  let usageEstimated = true
  let ttftAt: number | null = null
  const ttftTimer = setTimeout(() => controller.abort(), ttftMs)
  let totalTimer: ReturnType<typeof setTimeout> | null = null

  try {
    for await (const chunk of backend.stream(request, controller.signal)) {
      if (chunk.type === "usage") {
        promptTokens = chunk.promptTokens
        completionTokens = chunk.completionTokens
        gotUsage = true
        usageEstimated = chunk.estimated
        continue
      }
      if (!sawToken) {
        sawToken = true
        ttftAt = Date.now() - started
        clearTimeout(ttftTimer)
        const elapsed = Date.now() - started
        totalTimer = setTimeout(() => controller.abort(), Math.max(1, totalMs - elapsed))
      }
      raw += chunk.text
      if (!headerDone) {
        pending += chunk.text
        const newline = pending.indexOf("\n")
        if (newline !== -1) {
          const first = pending.slice(0, newline).trim()
          if (first.startsWith("{")) {
            headerDone = true
            const rest = pending.slice(newline + 1).replace(/^\n+/, "")
            if (rest) {
              forwarded = true
              onToken?.(rest)
            }
          }
        }
      } else {
        forwarded = true
        onToken?.(chunk.text)
      }
    }
    clearTimeout(ttftTimer)
    if (totalTimer) clearTimeout(totalTimer)
    if (!sawToken) {
      return {
        status: "error",
        error: "empty stream",
        raw,
        forwarded,
        headerDone,
        latencyMs: Date.now() - started,
        ttftMs: null,
        promptTokens,
        completionTokens,
        gotUsage,
        usageEstimated,
      }
    }
    return {
      status: "ok",
      error: null,
      raw,
      forwarded,
      headerDone,
      latencyMs: Date.now() - started,
      ttftMs: ttftAt,
      promptTokens,
      completionTokens,
      gotUsage,
      usageEstimated,
    }
  } catch (error) {
    clearTimeout(ttftTimer)
    if (totalTimer) clearTimeout(totalTimer)
    const aborted = controller.signal.aborted || isAbortError(error)
    return {
      status: aborted ? "timeout" : "error",
      error: aborted ? (sawToken ? "total timeout" : "ttft timeout") : error instanceof Error ? error.message : "backend error",
      raw,
      forwarded,
      headerDone,
      latencyMs: Date.now() - started,
      ttftMs: ttftAt,
      promptTokens,
      completionTokens,
      gotUsage,
      usageEstimated,
    }
  }
}
