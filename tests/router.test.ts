import { describe, expect, it } from "vitest"
import type { Backend } from "@/lib/backends/types"
import { executeWithFallback } from "@/lib/execute"
import { buildChain, chooseRoute } from "@/lib/routing"
import { sleep } from "@/lib/sleep"

const GOOD = `{"intent":"track_order"}\n\nYou can track order {{Order Number}} from the orders page in your account.`

function backend(options: {
  id: string
  tier: Backend["tier"]
  degraded?: boolean
  behavior?: "ok" | "throw" | "hang" | "empty"
  text?: string
}): Backend {
  return {
    id: options.id,
    model: options.id,
    tier: options.tier,
    degraded: options.degraded ?? false,
    async *stream(_request, signal) {
      if (options.behavior === "throw") throw new Error("upstream 503")
      if (options.behavior === "hang") {
        await sleep(500, signal)
        yield { type: "token", text: "late" }
        return
      }
      if (options.behavior === "empty") return
      yield { type: "token", text: options.text ?? GOOD }
      yield { type: "usage", promptTokens: 12, completionTokens: 18, estimated: false }
    },
  }
}

const request = {
  system: "system",
  user: "track my order",
  knnIntent: "track_order",
  retrieved: [],
}

describe("chooseRoute", () => {
  it("keeps a clear short question on the fast model", () => {
    expect(
      chooseRoute({ plan: "standard", message: "Where is my order?", voteShare: 0.9, margin: 0.8 }),
    ).toEqual({ rule: "default_fast", tier: "fast" })
  })

  it("escalates when the intent vote is ambiguous", () => {
    expect(
      chooseRoute({ plan: "standard", message: "Help me with this", voteShare: 0.42, margin: 0.05 }),
    ).toEqual({ rule: "escalate_ambiguous_retrieval", tier: "quality" })
  })

  it("escalates long or multi-part messages", () => {
    expect(
      chooseRoute({
        plan: "standard",
        message: "Can you check my invoice? And can you change the shipping address?",
        voteShare: 0.9,
        margin: 0.7,
      }),
    ).toEqual({ rule: "escalate_long_message", tier: "quality" })
  })

  it("honors a quality plan and an explicit tier override", () => {
    expect(
      chooseRoute({ plan: "quality", message: "Hi", voteShare: 0.9, margin: 0.8 }),
    ).toEqual({ rule: "plan_quality", tier: "quality" })
    expect(
      chooseRoute({
        plan: "standard",
        message: "Hi",
        voteShare: 0.9,
        margin: 0.8,
        forceTier: "quality",
      }),
    ).toEqual({ rule: "forced_tier", tier: "quality" })
  })
})

describe("buildChain", () => {
  const fast = backend({ id: "groq-fast", tier: "fast" })
  const quality = backend({ id: "groq-quality", tier: "quality" })
  const degraded = backend({ id: "mock-fast", tier: "degraded", degraded: true })

  it("orders primary, the other live model, then the degraded mock", () => {
    expect(buildChain([fast, quality, degraded], "fast").map((item) => item.id)).toEqual([
      "groq-fast",
      "groq-quality",
      "mock-fast",
    ])
    expect(buildChain([fast, quality, degraded], "quality").map((item) => item.id)).toEqual([
      "groq-quality",
      "groq-fast",
      "mock-fast",
    ])
  })
})

describe("executeWithFallback", () => {
  it("records an error and serves the next backend", async () => {
    const execution = await executeWithFallback({
      chain: [backend({ id: "mock-fast", tier: "fast" }), backend({ id: "mock-quality", tier: "quality" })],
      request,
      knnIntent: "track_order",
      primaryMode: "error",
    })
    expect(execution.fallbackFired).toBe(true)
    expect(execution.servedBy).toBe("mock-quality")
    expect(execution.outcome).toBe("ok")
    expect(execution.attempts.map((attempt) => attempt.status)).toEqual(["error", "ok"])
    expect(execution.fallbacks[0]).toMatchObject({ from: "mock-fast", to: "mock-quality", reason: "error" })
  })

  it("falls back when the primary hangs past the time-to-first-token deadline", async () => {
    const execution = await executeWithFallback({
      chain: [
        backend({ id: "mock-fast", tier: "fast", behavior: "hang" }),
        backend({ id: "mock-quality", tier: "quality" }),
      ],
      request,
      knnIntent: "track_order",
      ttftMs: 40,
      totalMs: 200,
    })
    expect(execution.servedBy).toBe("mock-quality")
    expect(execution.attempts[0]).toMatchObject({ status: "timeout", error: "ttft timeout" })
    expect(execution.fallbackFired).toBe(true)
  })

  it("treats garbage output as unusable and falls back", async () => {
    const execution = await executeWithFallback({
      chain: [backend({ id: "mock-fast", tier: "fast" }), backend({ id: "mock-quality", tier: "quality" })],
      request,
      knnIntent: "track_order",
      primaryMode: "garbage",
    })
    expect(execution.attempts[0].status).toBe("unusable")
    expect(execution.servedBy).toBe("mock-quality")
    expect(execution.assessment?.intent).toBe("track_order")
  })

  it("returns unusable when every backend produces garbage", async () => {
    const execution = await executeWithFallback({
      chain: [backend({ id: "mock-fast", tier: "fast" })],
      request,
      knnIntent: "track_order",
      primaryMode: "garbage",
    })
    expect(execution.outcome).toBe("unusable")
    expect(execution.servedBy).toBeNull()
  })
})
