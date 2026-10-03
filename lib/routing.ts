import { isAmbiguous } from "@/lib/confidence"
import type { Backend, BackendTier } from "@/lib/backends/types"

export type RouteTier = "fast" | "quality"

export function chooseRoute(input: {
  plan: string
  message: string
  voteShare: number
  margin: number
  forceTier?: RouteTier
}): { rule: string; tier: RouteTier } {
  if (input.forceTier) return { rule: "forced_tier", tier: input.forceTier }
  if (input.plan === "quality") return { rule: "plan_quality", tier: "quality" }
  if (isAmbiguous(input.voteShare, input.margin)) {
    return { rule: "escalate_ambiguous_retrieval", tier: "quality" }
  }
  const questions = input.message.match(/\?/g)?.length ?? 0
  if (input.message.length > 320 || questions >= 2) {
    return { rule: "escalate_long_message", tier: "quality" }
  }
  return { rule: "default_fast", tier: "fast" }
}

export function buildChain(backends: Backend[], tier: RouteTier): Backend[] {
  if (backends.length === 0) return []
  const primary =
    backends.find((backend) => backend.tier === tier && !backend.degraded) ??
    backends.find((backend) => backend.tier === tier) ??
    backends[0]
  const alternateTier: BackendTier = tier === "fast" ? "quality" : "fast"
  const alternate = backends.find(
    (backend) => backend.tier === alternateTier && !backend.degraded && backend.id !== primary.id,
  )
  const degraded = backends.find((backend) => backend.degraded && backend.id !== primary.id)
  const chain = [primary]
  if (alternate) chain.push(alternate)
  if (degraded && !chain.some((backend) => backend.id === degraded.id)) chain.push(degraded)
  return chain
}
