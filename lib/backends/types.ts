import type { ScoredEntry } from "@/lib/retrieval/bm25"

export type BackendTier = "fast" | "quality" | "degraded"

export type BackendChunk =
  | { type: "token"; text: string }
  | { type: "usage"; promptTokens: number; completionTokens: number; estimated: boolean }

export type BackendRequest = {
  system: string
  user: string
  knnIntent: string
  retrieved: ScoredEntry[]
  debug?: {
    tokenDelayMs?: number
  }
}

export type Backend = {
  id: string
  model: string
  tier: BackendTier
  degraded: boolean
  stream(request: BackendRequest, signal: AbortSignal): AsyncIterable<BackendChunk>
}

export type PrimaryMode = "ok" | "error" | "hang" | "garbage"
