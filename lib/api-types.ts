import type { AttemptRecord, FallbackEvent } from "@/lib/execute"

export type RetrievedView = {
  id: string
  intent: string
  instruction: string
  score: number
}

export type MetaEvent = {
  requestId: string
  routeRule: string
  chain: string[]
  primary: string | null
  retrieved: RetrievedView[]
  knnIntent: string | null
  preConfidence: number
  preBand: string
}

export type DoneEvent = {
  requestId: string
  servedBy: string | null
  model: string | null
  fallbackFired: boolean
  degraded: boolean
  intent: string | null
  confidence: number | null
  confidenceBand: string | null
  refused: boolean
  outcome: string
  promptTokens: number
  completionTokens: number
  tokensEstimated: boolean
  costUsd: number
  latencyMs: number
  ttftMs: number | null
  attempts: AttemptRecord[]
  fallbacks: FallbackEvent[]
  answer: string
  routeRule: string
}

export type UsageTenant = {
  id: string
  name: string
  plan: string
  quotaTokens: number
  usedTokens: number
  reservedTokens: number
  remainingTokens: number
  requests: number
  costUsd: number
  recent: Array<{
    id: string
    createdAt: string
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
  }>
}

export type UsageResponse = {
  period: string
  resetsAt: string
  tenants: UsageTenant[]
}
