import { describe, expect, it } from "vitest"
import { finalConfidence, preConfidence } from "@/lib/confidence"
import { estimateCost } from "@/lib/cost"
import { assessOutput } from "@/lib/parse-model"

const ANSWER =
  "You can track order {{Order Number}} from the orders page after you sign in to your account."

describe("preConfidence", () => {
  it("accepts a strong single-intent retrieval", () => {
    const result = preConfidence([
      { intent: "track_order", score: 12 },
      { intent: "track_order", score: 9 },
      { intent: "track_order", score: 7 },
    ])
    expect(result.refuse).toBe(false)
    expect(result.intent).toBe("track_order")
    expect(result.band === "high" || result.band === "medium").toBe(true)
  })

  it("refuses when nothing relevant was retrieved", () => {
    expect(preConfidence([]).refuse).toBe(true)
    expect(preConfidence([]).reason).toBe("weak_retrieval")
    expect(preConfidence([{ intent: "review", score: 0.4 }]).refuse).toBe(true)
  })

  it("refuses a high score that only overlaps a sliver of the question", () => {
    const result = preConfidence([{ intent: "review", score: 12, coverage: 0.2 }])
    expect(result.refuse).toBe(true)
    expect(result.reason).toBe("weak_retrieval")
  })
})

describe("finalConfidence", () => {
  it("refuses when the model intent disagrees and retrieval was only middling", () => {
    const result = finalConfidence({
      preScore: 0.5,
      voteShare: 0.4,
      llmIntent: "get_refund",
      knnIntent: "track_order",
      usedKnnIntent: false,
    })
    expect(result.refuse).toBe(true)
    expect(result.agreement).toBe(false)
  })

  it("keeps the answer when retrieval and the model agree", () => {
    const result = finalConfidence({
      preScore: 0.8,
      voteShare: 0.9,
      llmIntent: "track_order",
      knnIntent: "track_order",
      usedKnnIntent: false,
    })
    expect(result.refuse).toBe(false)
    expect(result.band).toBe("high")
  })
})

describe("assessOutput", () => {
  it("parses a valid intent header and answer", () => {
    const result = assessOutput(`{"intent":"track_order"}\n\n${ANSWER}`, "cancel_order")
    expect(result.usable).toBe(true)
    expect(result.intent).toBe("track_order")
    expect(result.usedKnnIntent).toBe(false)
    expect(result.answer).toContain("track order")
  })

  it("rejects an intent outside the closed label set", () => {
    const result = assessOutput(`{"intent":"unknown"}\n\n${ANSWER}`, "track_order")
    expect(result.usable).toBe(false)
    expect(result.reason).toBe("invalid_intent")
  })

  it("rejects symbol garbage", () => {
    const result = assessOutput("??? @@ ##", "track_order")
    expect(result.usable).toBe(false)
  })

  it("falls back to the kNN intent when the header is missing but the answer is prose", () => {
    const result = assessOutput(ANSWER, "track_order")
    expect(result.usable).toBe(true)
    expect(result.intent).toBe("track_order")
    expect(result.usedKnnIntent).toBe(true)
  })

  it("marks an explicit decline so the gateway can refuse instead of guessing", () => {
    const result = assessOutput(
      '{"intent":"track_order"}\n\nI don\'t know which order you mean.',
      "track_order",
    )
    expect(result.usable).toBe(true)
    expect(result.declined).toBe(true)
  })
})

describe("estimateCost", () => {
  it("prices the 8B and 70B stand-ins from the published per-million rates", () => {
    expect(estimateCost("mock-llama-8b", 1_000_000, 1_000_000)).toBeCloseTo(0.13)
    expect(estimateCost("mock-llama-70b", 1_000_000, 0)).toBeCloseTo(0.59)
    expect(estimateCost("mock-llama-8b", 0, 0)).toBe(0)
  })
})
