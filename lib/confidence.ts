export const PRE_REFUSAL_THRESHOLD = 0.42
export const FINAL_REFUSAL_THRESHOLD = 0.45
export const MIN_BM25_SCORE = 3.2
export const MIN_QUERY_COVERAGE = 0.3

export type ConfidenceBand = "high" | "medium" | "low"

export type ScoredIntent = {
  intent: string
  score: number
  coverage?: number
}

export function bandFor(score: number): ConfidenceBand {
  if (score >= 0.72) return "high"
  if (score >= FINAL_REFUSAL_THRESHOLD) return "medium"
  return "low"
}

export function knnVote(hits: ScoredIntent[]): {
  intent: string | null
  voteShare: number
  margin: number
} {
  const weights = new Map<string, number>()
  let total = 0
  for (const hit of hits) {
    const weight = Math.max(hit.score, 0)
    weights.set(hit.intent, (weights.get(hit.intent) ?? 0) + weight)
    total += weight
  }
  const ranked = [...weights.entries()].sort((a, b) => b[1] - a[1])
  const top = ranked[0]
  const second = ranked[1]
  if (!top || total <= 0) {
    return { intent: null, voteShare: 0, margin: 0 }
  }
  return {
    intent: top[0],
    voteShare: top[1] / total,
    margin: (top[1] - (second?.[1] ?? 0)) / total,
  }
}

export function isAmbiguous(voteShare: number, margin: number): boolean {
  return voteShare < 0.6 || margin < 0.15
}

export function preConfidence(hits: ScoredIntent[]): {
  intent: string | null
  voteShare: number
  margin: number
  topScore: number
  score: number
  band: ConfidenceBand
  refuse: boolean
  reason: "weak_retrieval" | "low_confidence" | null
} {
  const vote = knnVote(hits)
  const topScore = hits[0]?.score ?? 0
  const norm = Math.min(1, topScore / 14)
  const score =
    hits.length === 0
      ? 0
      : 0.5 * norm + 0.35 * vote.voteShare + 0.15 * Math.min(1, vote.margin * 2)
  const coverage = hits[0]?.coverage
  const thinOverlap = coverage != null && coverage < MIN_QUERY_COVERAGE
  const weak = hits.length === 0 || topScore < MIN_BM25_SCORE || thinOverlap
  const low = score < PRE_REFUSAL_THRESHOLD
  const refuse = weak || low
  return {
    ...vote,
    topScore,
    score,
    band: bandFor(score),
    refuse,
    reason: refuse ? (weak ? "weak_retrieval" : "low_confidence") : null,
  }
}

export function finalConfidence(input: {
  preScore: number
  voteShare: number
  llmIntent: string | null
  knnIntent: string | null
  usedKnnIntent: boolean
}): { score: number; band: ConfidenceBand; refuse: boolean; agreement: boolean } {
  const agreement = Boolean(
    input.llmIntent &&
      input.knnIntent &&
      input.llmIntent === input.knnIntent &&
      !input.usedKnnIntent,
  )
  let score = 0.5 * input.preScore + 0.2 * input.voteShare + 0.3 * (agreement ? 1 : 0)
  if (input.usedKnnIntent) score *= 0.85
  return {
    score,
    band: bandFor(score),
    refuse: score < FINAL_REFUSAL_THRESHOLD,
    agreement,
  }
}
