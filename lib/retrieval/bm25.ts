export type KbEntry = {
  id: string
  intent: string
  instruction: string
  response: string
}

export type ScoredEntry = KbEntry & { score: number; coverage: number }

const STOP = new Set(
  "a an the of to for and or in on at is my i we you your our with from about please can could would how what when where do does did me it this that".split(
    " ",
  ),
)

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\{\{[^}]*\}\}/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !STOP.has(token))
}

type DocStats = {
  tf: Map<string, number>
  len: number
}

export type Bm25Index = {
  entries: KbEntry[]
  docs: DocStats[]
  idf: Map<string, number>
  avgdl: number
  k1: number
  b: number
}

export function buildBm25(entries: KbEntry[], k1 = 1.2, b = 0.75): Bm25Index {
  const df = new Map<string, number>()
  const docs = entries.map((entry) => {
    const tokens = tokenize(`${entry.instruction} ${entry.intent.replaceAll("_", " ")}`)
    const tf = new Map<string, number>()
    for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1)
    for (const token of tf.keys()) df.set(token, (df.get(token) ?? 0) + 1)
    return { tf, len: tokens.length }
  })
  const total = entries.length
  const avgdl = docs.reduce((sum, doc) => sum + doc.len, 0) / (total || 1)
  const idf = new Map<string, number>()
  for (const [token, count] of df) {
    idf.set(token, Math.log(1 + (total - count + 0.5) / (count + 0.5)))
  }
  return { entries, docs, idf, avgdl, k1, b }
}

export function searchBm25(index: Bm25Index, query: string, k = 5): ScoredEntry[] {
  const queryTokens = [...new Set(tokenize(query))]
  if (queryTokens.length === 0 || index.entries.length === 0) return []
  const scored = index.docs.map((doc, entryIndex) => {
    let score = 0
    let matched = 0
    for (const token of queryTokens) {
      const freq = doc.tf.get(token) ?? 0
      if (!freq) continue
      matched += 1
      const idf = index.idf.get(token) ?? 0
      const denom = freq + index.k1 * (1 - index.b + index.b * (doc.len / index.avgdl))
      score += idf * ((freq * (index.k1 + 1)) / denom)
    }
    return { entryIndex, score, coverage: matched / queryTokens.length }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored
    .filter((item) => item.score > 0)
    .slice(0, k)
    .map((item) => ({
      ...index.entries[item.entryIndex],
      score: item.score,
      coverage: item.coverage,
    }))
}
