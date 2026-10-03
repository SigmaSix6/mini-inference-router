import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

const SEED = 20261003
const PER_INTENT = 50
const SOURCE = "bitext/Bitext-customer-support-llm-chatbot-training-dataset"

const OUT_OF_SCOPE = [
  {
    id: "oos_weather",
    intent: null,
    instruction: "What's the weather in Lisbon tomorrow?",
    reference: "",
  },
  {
    id: "oos_poem",
    intent: null,
    instruction: "Write a short poem about the ocean at night.",
    reference: "",
  },
  {
    id: "oos_sports",
    intent: null,
    instruction: "Who won the 2019 world series?",
    reference: "",
  },
  {
    id: "oos_translate",
    intent: null,
    instruction: "Translate hello to Japanese.",
    reference: "",
  },
  {
    id: "oos_capital",
    intent: null,
    instruction: "What is the capital of Mongolia?",
    reference: "",
  },
]

type Row = {
  instruction: string
  intent: string
  response: string
}

function parseCsv(input: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let inQuotes = false
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]
    if (inQuotes) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }
    if (char === '"') inQuotes = true
    else if (char === ",") {
      row.push(field)
      field = ""
    } else if (char === "\n") {
      row.push(field)
      field = ""
      if (!(row.length === 1 && row[0] === "")) rows.push(row)
      row = []
    } else if (char !== "\r") field += char
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function normalizeInstruction(value: string): string {
  return value
    .toLowerCase()
    .replace(/\{\{[^}]*\}\}/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function hashString(value: string): number {
  let hash = 2166136261
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return hash >>> 0
}

function mulberry32(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const copy = items.slice()
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1))
    const current = copy[index]
    copy[index] = copy[swap]
    copy[swap] = current
  }
  return copy
}

const csvPath = process.env.BITEXT_CSV ?? "/tmp/bitext.csv"
const table = parseCsv(readFileSync(csvPath, "utf8"))
const header = table[0]
const instructionIndex = header.indexOf("instruction")
const intentIndex = header.indexOf("intent")
const responseIndex = header.indexOf("response")
if (instructionIndex < 0 || intentIndex < 0 || responseIndex < 0) {
  throw new Error(`unexpected CSV header: ${header.join(",")}`)
}

const grouped = new Map<string, Row[]>()
const seen = new Set<string>()
for (const cells of table.slice(1)) {
  const instruction = cells[instructionIndex]?.trim()
  const intent = cells[intentIndex]?.trim()
  const response = cells[responseIndex]?.trim()
  if (!instruction || !intent || !response) continue
  const key = `${intent}::${normalizeInstruction(instruction)}`
  if (seen.has(key)) continue
  seen.add(key)
  const list = grouped.get(intent) ?? []
  list.push({ instruction, intent, response })
  grouped.set(intent, list)
}

const intents = [...grouped.keys()].sort()
const dev: Array<Row & { id: string }> = []
const evalPool = new Map<string, Row[]>()

for (const intent of intents) {
  const rng = mulberry32(SEED ^ hashString(intent))
  const shuffled = shuffle(grouped.get(intent) ?? [], rng)
  dev.push(
    ...shuffled.slice(0, 2).map((row, index) => ({
      ...row,
      id: `dev_${intent}_${index + 1}`,
    })),
  )
  evalPool.set(intent, shuffled.slice(2, 4))
}

const heldOut: Array<Row & { id: string }> = []
for (const intent of intents) {
  const row = evalPool.get(intent)?.[0]
  if (row) heldOut.push({ ...row, id: `eval_${intent}_1` })
}
for (const intent of intents.slice(0, 3)) {
  const row = evalPool.get(intent)?.[1]
  if (row) heldOut.push({ ...row, id: `eval_${intent}_2` })
}

const banned = new Set(
  [...dev, ...heldOut].map((row) => `${row.intent}::${normalizeInstruction(row.instruction)}`),
)

const entries: Array<Row & { id: string }> = []
for (const intent of intents) {
  const rng = mulberry32((SEED + 17) ^ hashString(intent))
  const shuffled = shuffle(grouped.get(intent) ?? [], rng)
  let taken = 0
  for (const row of shuffled) {
    if (taken >= PER_INTENT) break
    const key = `${intent}::${normalizeInstruction(row.instruction)}`
    if (banned.has(key)) continue
    taken += 1
    entries.push({ ...row, id: `kb_${intent}_${taken}` })
  }
}

mkdirSync(resolve("data"), { recursive: true })
writeFileSync(
  resolve("data/kb.json"),
  JSON.stringify(
    { version: 1, seed: SEED, source: SOURCE, perIntent: PER_INTENT, entries },
    null,
    2,
  ),
)
writeFileSync(
  resolve("data/eval.json"),
  JSON.stringify(
    {
      seed: SEED,
      source: SOURCE,
      cases: [
        ...heldOut.map((row) => ({
          id: row.id,
          intent: row.intent,
          instruction: row.instruction,
          reference: row.response,
          split: "heldout" as const,
        })),
        ...OUT_OF_SCOPE.map((row) => ({ ...row, split: "out_of_scope" as const })),
      ],
    },
    null,
    2,
  ),
)
writeFileSync(
  resolve("data/dev.json"),
  JSON.stringify({ seed: SEED, source: SOURCE, cases: dev }, null, 2),
)

const counts = new Map<string, number>()
for (const entry of entries) counts.set(entry.intent, (counts.get(entry.intent) ?? 0) + 1)
console.log(`intents ${intents.length}`)
console.log(`kb ${entries.length}`)
console.log(`heldout ${heldOut.length}`)
console.log(`dev ${dev.length}`)
console.log(`kb per intent min ${Math.min(...counts.values())} max ${Math.max(...counts.values())}`)
