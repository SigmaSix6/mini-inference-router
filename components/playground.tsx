"use client"

import { useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { DoneEvent, MetaEvent } from "@/lib/api-types"
import { DEMO_TENANTS } from "@/lib/demo-tenants"
import type { FallbackEvent } from "@/lib/execute"

type Turn = {
  id: string
  role: "user" | "assistant"
  text: string
  meta?: MetaEvent
  fallbacks: FallbackEvent[]
  done?: DoneEvent
  error?: string
}

const SUGGESTIONS = [
  { label: "Track an order", message: "How do I track order {{Order Number}}?" },
  { label: "Refund policy", message: "What is your refund policy if an item arrives damaged?" },
  {
    label: "Two questions",
    message: "Can you check invoice {{Invoice Number}}? And can you change the shipping address on order {{Order Number}}?",
  },
  { label: "Out of scope", message: "What's the weather in Lisbon tomorrow?" },
]

export function Playground() {
  const [tenantId, setTenantId] = useState<string>(DEMO_TENANTS[0].name)
  const [customKey, setCustomKey] = useState("")
  const [message, setMessage] = useState(SUGGESTIONS[0].message)
  const [primaryMode, setPrimaryMode] = useState<"ok" | "error" | "hang" | "garbage">("ok")
  const [forceTier, setForceTier] = useState<"" | "fast" | "quality">("")
  const [turns, setTurns] = useState<Turn[]>([])
  const [sending, setSending] = useState(false)

  const apiKey = useMemo(() => {
    if (tenantId === "custom") return customKey.trim()
    return DEMO_TENANTS.find((tenant) => tenant.name === tenantId)?.apiKey ?? ""
  }, [tenantId, customKey])

  const latest = [...turns].reverse().find((turn) => turn.role === "assistant")

  async function send(text?: string) {
    const content = (text ?? message).trim()
    if (!content || sending) return
    if (!apiKey) {
      setTurns((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "user", text: content, fallbacks: [] },
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: "",
          fallbacks: [],
          error: "Paste a tenant API key before sending.",
        },
      ])
      return
    }

    const userId = crypto.randomUUID()
    const assistantId = crypto.randomUUID()
    setTurns((current) => [
      ...current,
      { id: userId, role: "user", text: content, fallbacks: [] },
      { id: assistantId, role: "assistant", text: "", fallbacks: [] },
    ])
    setSending(true)

    const patch = (update: (turn: Turn) => Turn) => {
      setTurns((current) => current.map((turn) => (turn.id === assistantId ? update(turn) : turn)))
    }

    try {
      const response = await fetch("/api/v1/support/chat", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: content,
          debug: {
            primaryMode,
            ...(forceTier ? { forceTier } : {}),
          },
        }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string; error?: string } | null
        patch((turn) => ({
          ...turn,
          error: body?.message ?? `Request failed (${response.status}).`,
        }))
        return
      }
      if (!response.body) {
        patch((turn) => ({ ...turn, error: "The gateway returned an empty stream." }))
        return
      }
      await readSse(response.body, patch)
    } catch (error) {
      patch((turn) => ({
        ...turn,
        error: error instanceof Error ? error.message : "The request failed.",
      }))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="flex min-h-[70vh] flex-col gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Playground</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Ask a support question. The answer streams in, and the inspector records the model, any fallback,
            the retrieved entries, the intent, and the meter.
          </p>
        </div>

        <Card>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <Label>Tenant</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {DEMO_TENANTS.map((tenant) => (
                  <button
                    key={tenant.name}
                    type="button"
                    onClick={() => setTenantId(tenant.name)}
                    className={`rounded-lg border px-3 py-2 text-left ${
                      tenantId === tenant.name ? "border-primary bg-primary/5" : "border-border bg-background"
                    }`}
                  >
                    <div className="text-sm font-medium">{tenant.name}</div>
                    <div className="metric mt-1 text-[11px] text-muted-foreground">
                      {tenant.quotaTokens.toLocaleString()} tokens/day · {tenant.apiKey.slice(-6)}
                    </div>
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setTenantId("custom")}
                className={`rounded-lg border px-3 py-2 text-left text-sm ${
                  tenantId === "custom" ? "border-primary bg-primary/5" : "border-border"
                }`}
              >
                Paste a different key
              </button>
              {tenantId === "custom" ? (
                <Input
                  value={customKey}
                  onChange={(event) => setCustomKey(event.target.value)}
                  placeholder="mir_demo_..."
                  className="h-10 metric"
                  autoComplete="off"
                />
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">Primary backend</span>
                <select
                  className="h-10 rounded-lg border border-input bg-background px-2.5 text-sm"
                  value={primaryMode}
                  onChange={(event) => setPrimaryMode(event.target.value as typeof primaryMode)}
                >
                  <option value="ok">Normal</option>
                  <option value="error">Inject error</option>
                  <option value="hang">Inject hang</option>
                  <option value="garbage">Inject garbage</option>
                </select>
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">Route</span>
                <select
                  className="h-10 rounded-lg border border-input bg-background px-2.5 text-sm"
                  value={forceTier}
                  onChange={(event) => setForceTier(event.target.value as typeof forceTier)}
                >
                  <option value="">Auto</option>
                  <option value="fast">Force fast (8B-class)</option>
                  <option value="quality">Force quality (70B-class)</option>
                </select>
              </label>
            </div>
          </CardContent>
        </Card>

        <Card className="flex-1">
          <CardContent className="flex h-full flex-col gap-3">
            <div className="flex min-h-64 flex-1 flex-col gap-3 overflow-y-auto">
              {turns.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No messages yet. Try a suggested question, or ask something the knowledge base should refuse.
                </p>
              ) : (
                turns.map((turn) => (
                  <article
                    key={turn.id}
                    className={`max-w-[42rem] rounded-xl px-3 py-2 text-sm leading-6 ${
                      turn.role === "user" ? "ml-auto bg-primary text-primary-foreground" : "bg-muted"
                    }`}
                  >
                    <div className="mb-1 text-[11px] uppercase tracking-wide opacity-70">
                      {turn.role === "user" ? "Customer" : "Relay"}
                    </div>
                    <p className="whitespace-pre-wrap">
                      {turn.text || (turn.error ? "" : sending ? "Waiting for the first token…" : "")}
                    </p>
                    {turn.error ? <p className="mt-1 text-destructive">{turn.error}</p> : null}
                  </article>
                ))
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <Button
                  key={suggestion.label}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setMessage(suggestion.message)
                    void send(suggestion.message)
                  }}
                  disabled={sending}
                >
                  {suggestion.label}
                </Button>
              ))}
            </div>
            <Textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Ask about an order, refund, invoice, or account."
              className="min-h-24"
            />
            <div className="flex justify-end">
              <Button type="button" size="lg" onClick={() => void send()} disabled={sending || !message.trim()}>
                {sending ? "Streaming…" : "Send"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

      <Inspector turn={latest} />
    </div>
  )
}

function Inspector({ turn }: { turn?: Turn }) {
  const done = turn?.done
  const meta = turn?.meta
  return (
    <aside className="grid content-start gap-3">
      <Card size="sm">
        <CardHeader>
          <CardTitle>Route</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          <Row label="Rule" value={done?.routeRule ?? meta?.routeRule ?? "—"} />
          <Row label="Served by" value={done?.servedBy ?? "—"} />
          <Row label="Model" value={done?.model ?? "—"} />
          <Row label="Outcome" value={done?.outcome ?? (turn?.error ? "error" : "—")} />
          <div className="flex flex-wrap gap-1">
            {done?.fallbackFired ? <Badge variant="destructive">Fallback</Badge> : <Badge variant="outline">No fallback</Badge>}
            {done?.degraded ? <Badge variant="secondary">Degraded</Badge> : null}
            {done?.refused ? <Badge>Refused</Badge> : null}
            {done?.tokensEstimated ? <Badge variant="outline">Estimated tokens</Badge> : null}
          </div>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Fallback</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {(done?.fallbacks.length ?? turn?.fallbacks.length ?? 0) === 0 ? (
            <p className="text-muted-foreground">No fallback on this turn.</p>
          ) : (
            <ol className="grid gap-2">
              {(done?.fallbacks ?? turn?.fallbacks ?? []).map((item, index) => (
                <li key={`${item.from}-${index}`} className="metric text-xs leading-5">
                  {item.from} → {item.to}
                  <span className="block text-muted-foreground">{item.reason}</span>
                </li>
              ))}
            </ol>
          )}
          {done && done.attempts.length > 0 ? (
            <ul className="mt-3 grid gap-1 border-t border-border pt-2">
              {done.attempts.map((attempt) => (
                <li key={attempt.seq} className="metric text-[11px] text-muted-foreground">
                  {attempt.seq}. {attempt.backend} · {attempt.status}
                  {attempt.error ? ` · ${attempt.error}` : ""} · {attempt.latencyMs} ms
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Retrieval</CardTitle>
        </CardHeader>
        <CardContent className="grid max-h-64 gap-2 overflow-y-auto text-sm">
          {!meta || meta.retrieved.length === 0 ? (
            <p className="text-muted-foreground">Retrieved entries show up after a request.</p>
          ) : (
            meta.retrieved.map((hit) => (
              <div key={hit.id} className="rounded-md border border-border px-2 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="metric text-[11px]">{hit.intent}</span>
                  <span className="metric text-[11px] text-muted-foreground">{hit.score.toFixed(2)}</span>
                </div>
                <p className="mt-1 text-xs leading-5">{hit.instruction}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Intent</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          <Row label="Detected" value={done?.intent ?? meta?.knnIntent ?? "—"} />
          <Row label="kNN" value={meta?.knnIntent ?? "—"} />
          <Row
            label="Confidence"
            value={
              done?.confidence != null
                ? `${done.confidence.toFixed(2)} ${done.confidenceBand ?? ""}`.trim()
                : meta
                  ? `${meta.preConfidence.toFixed(2)} ${meta.preBand} pre`
                  : "—"
            }
          />
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Meter</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          <Row
            label="Tokens"
            value={done ? `${done.promptTokens} in · ${done.completionTokens} out` : "—"}
          />
          <Row label="Latency" value={done ? `${done.latencyMs} ms` : "—"} />
          <Row label="TTFT" value={done?.ttftMs != null ? `${done.ttftMs} ms` : "—"} />
          <Row label="Cost" value={done ? formatUsd(done.costUsd) : "—"} />
        </CardContent>
      </Card>
    </aside>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="metric text-right text-xs">{value}</span>
    </div>
  )
}

function formatUsd(value: number) {
  return value < 0.01 ? `$${value.toFixed(6)}` : `$${value.toFixed(4)}`
}

async function readSse(body: ReadableStream<Uint8Array>, patch: (update: (turn: Turn) => Turn) => void) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    buffer += decoder.decode(chunk.value, { stream: true })
    const blocks = buffer.split("\n\n")
    buffer = blocks.pop() ?? ""
    for (const block of blocks) applyBlock(block, patch)
  }
  if (buffer.trim()) applyBlock(buffer, patch)
}

function applyBlock(block: string, patch: (update: (turn: Turn) => Turn) => void) {
  let event = "message"
  const dataLines: string[] = []
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim()
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim())
  }
  if (dataLines.length === 0) return
  const data = JSON.parse(dataLines.join("\n")) as unknown
  if (event === "meta") {
    patch((turn) => ({ ...turn, meta: data as MetaEvent }))
  } else if (event === "token") {
    const text = (data as { text?: string }).text ?? ""
    patch((turn) => ({ ...turn, text: turn.text + text }))
  } else if (event === "reset") {
    patch((turn) => ({ ...turn, text: "" }))
  } else if (event === "fallback") {
    patch((turn) => ({ ...turn, text: "", fallbacks: [...turn.fallbacks, data as FallbackEvent] }))
  } else if (event === "done") {
    const done = data as DoneEvent
    patch((turn) => ({ ...turn, done, text: done.answer || turn.text, fallbacks: done.fallbacks }))
  } else if (event === "error") {
    patch((turn) => ({ ...turn, error: (data as { message?: string }).message ?? "Stream error" }))
  }
}
