import { config } from "dotenv"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { DEMO_TENANTS } from "../lib/demo-tenants"
import { percentile, rougeL } from "../lib/rouge"

config({ path: ".env.local" })

type EvalCase = {
  id: string
  intent: string | null
  instruction: string
  reference: string
  split: "heldout" | "out_of_scope"
}

type SseDone = {
  intent: string | null
  refused: boolean
  outcome: string
  promptTokens: number
  completionTokens: number
  costUsd: number
  latencyMs: number
  answer: string
  servedBy: string | null
  model: string | null
  fallbackFired: boolean
}

const file = JSON.parse(readFileSync(resolve("data/eval.json"), "utf8")) as { cases: EvalCase[] }
const base = process.env.EVAL_BASE_URL ?? "http://127.0.0.1:43123"
const apiKey = process.env.EVAL_API_KEY ?? DEMO_TENANTS[0].apiKey
const configs = [
  { name: "fast-8b-class", forceTier: "fast" as const },
  { name: "quality-70b-class", forceTier: "quality" as const },
]

async function runCase(item: EvalCase, forceTier: "fast" | "quality"): Promise<SseDone> {
  const response = await fetch(`${base}/api/v1/support/chat`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: item.instruction,
      debug: { forceTier, tokenDelayMs: 0, primaryMode: "ok" },
    }),
  })
  if (!response.ok || !response.body) {
    const text = await response.text()
    throw new Error(`${response.status} ${text.slice(0, 240)}`)
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let done: SseDone | null = null
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    buffer += decoder.decode(chunk.value, { stream: true })
    const blocks = buffer.split("\n\n")
    buffer = blocks.pop() ?? ""
    for (const block of blocks) {
      const eventLine = block.split("\n").find((line) => line.startsWith("event:"))
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n")
      if (eventLine?.slice(6).trim() === "done" && data) done = JSON.parse(data) as SseDone
    }
  }
  if (!done) throw new Error(`no done event for ${item.id}`)
  return done
}

function summarize(name: string, rows: Array<{ item: EvalCase; done: SseDone }>) {
  const held = rows.filter((row) => row.item.split === "heldout")
  const oos = rows.filter((row) => row.item.split === "out_of_scope")
  const intentHits = held.filter((row) => !row.done.refused && row.done.intent === row.item.intent).length
  const refusals = held.filter((row) => row.done.refused).length
  const scores = held
    .filter((row) => !row.done.refused)
    .map((row) => rougeL(row.done.answer, row.item.reference))
  const latencies = held.map((row) => row.done.latencyMs)
  const cost = held.reduce((sum, row) => sum + row.done.costUsd, 0)
  const prompt = held.reduce((sum, row) => sum + row.done.promptTokens, 0)
  const completion = held.reduce((sum, row) => sum + row.done.completionTokens, 0)
  const oosRefused = oos.filter((row) => row.done.refused).length
  return {
    name,
    cases: held.length,
    intentAccuracy: held.length ? intentHits / held.length : 0,
    inScopeRefusalRate: held.length ? refusals / held.length : 0,
    rougeL: scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0,
    p50: percentile(latencies, 0.5),
    p95: percentile(latencies, 0.95),
    cost,
    prompt,
    completion,
    outOfScope: oos.length,
    outOfScopeRefusalRate: oos.length ? oosRefused / oos.length : 0,
    model: held[0]?.done.model ?? "unknown",
    servedBy: held[0]?.done.servedBy ?? "unknown",
  }
}

async function main() {
  const summaries = []
  const failures: string[] = []
  for (const config of configs) {
    const rows: Array<{ item: EvalCase; done: SseDone }> = []
    for (const item of file.cases) {
      try {
        const done = await runCase(item, config.forceTier)
        rows.push({ item, done })
        process.stdout.write(".")
      } catch (error) {
        failures.push(`${config.name} ${item.id}: ${error instanceof Error ? error.message : String(error)}`)
        process.stdout.write("x")
      }
    }
    process.stdout.write("\n")
    const summary = summarize(config.name, rows)
    const judgeMean = await meanJudge(rows)
    summaries.push({ ...summary, judgeMean })
  }
  writeReport(summaries, failures)
  if (failures.length) process.exitCode = 1
}

async function meanJudge(rows: Array<{ item: EvalCase; done: SseDone }>): Promise<number | null> {
  if (process.env.EVAL_JUDGE !== "1" || !process.env.GROQ_API_KEY?.trim()) return null
  const scores: number[] = []
  for (const row of rows) {
    if (row.item.split !== "heldout" || row.done.refused) continue
    const score = await judgeScore(row.item.reference, row.done.answer)
    if (score != null) scores.push(score)
  }
  if (scores.length === 0) return null
  return scores.reduce((sum, score) => sum + score, 0) / scores.length
}

async function judgeScore(reference: string, answer: string): Promise<number | null> {
  const apiKey = process.env.GROQ_API_KEY?.trim()
  if (!apiKey) return null
  const model = process.env.GROQ_QUALITY_MODEL?.trim() || "openai/gpt-oss-120b"
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 16,
      messages: [
        {
          role: "system",
          content:
            "You compare a candidate customer-support answer to a reference. Score only factual overlap from 1 (wrong or empty) to 5 (same facts, placeholders allowed). Reply with a single integer.",
        },
        { role: "user", content: `Reference:\n${reference}\n\nCandidate:\n${answer}` },
      ],
    }),
  })
  if (!response.ok) return null
  const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const text = body.choices?.[0]?.message?.content ?? ""
  const match = text.match(/[1-5]/)
  return match ? Number(match[0]) : null
}

function writeReport(
  summaries: Array<ReturnType<typeof summarize> & { judgeMean: number | null }>,
  failures: string[],
) {
  const groq = Boolean(process.env.GROQ_API_KEY?.trim())
  const lines = [
    "# Eval results",
    "",
    `Ran against ${base} on ${new Date().toISOString()}.`,
    groq
      ? "Groq was configured, so these numbers are live model calls."
      : "No GROQ_API_KEY was set. Fast and quality configs used the mock Llama 8B and Llama 70B stand-ins. The mock copies a retrieved Bitext answer (two sentences on fast, the full entry on quality), so intent accuracy mostly measures BM25, and cost and latency reflect the price table plus simulated time-to-first-token. Run again with a key for real generations.",
    "",
    "Answer quality is mean ROUGE-L F1 against the held-out reference. An LLM judge (1–5, quality model, fixed rubric) runs only when both `GROQ_API_KEY` and `EVAL_JUDGE=1` are set.",
    "",
    "| Config | Served by | Intent accuracy | In-scope refusal | Mean ROUGE-L | Judge | p50 ms | p95 ms | Cost USD | Prompt tokens | Completion tokens | Out-of-scope refusal |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...summaries.map(
      (row) =>
        `| ${row.name} | ${row.servedBy} (${row.model}) | ${(row.intentAccuracy * 100).toFixed(1)}% | ${(row.inScopeRefusalRate * 100).toFixed(1)}% | ${row.rougeL.toFixed(3)} | ${row.judgeMean == null ? "—" : row.judgeMean.toFixed(2)} | ${row.p50} | ${row.p95} | ${row.cost.toFixed(6)} | ${row.prompt} | ${row.completion} | ${(row.outOfScopeRefusalRate * 100).toFixed(1)}% (${row.outOfScope}) |`,
    ),
    "",
  ]
  if (failures.length) {
    lines.push("## Failures", "", ...failures.map((failure) => `- ${failure}`), "")
  }
  mkdirSync(resolve("eval"), { recursive: true })
  const output = resolve("eval/results.md")
  writeFileSync(output, `${lines.join("\n")}\n`)
  console.log(`wrote ${output}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
