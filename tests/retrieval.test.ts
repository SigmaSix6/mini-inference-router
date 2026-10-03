import { describe, expect, it } from "vitest"
import { buildBm25, searchBm25, type KbEntry } from "@/lib/retrieval/bm25"

const entries: KbEntry[] = [
  {
    id: "1",
    intent: "track_order",
    instruction: "How can I track my order {{Order Number}}?",
    response: "Sign in and open orders.",
  },
  {
    id: "2",
    intent: "get_refund",
    instruction: "I want a refund for a damaged item",
    response: "Refunds start from the order page.",
  },
  {
    id: "3",
    intent: "recover_password",
    instruction: "I forgot my password and cannot sign in",
    response: "Use the password reset link.",
  },
  {
    id: "4",
    intent: "delivery_period",
    instruction: "How long does standard delivery take?",
    response: "Standard delivery takes a few days.",
  },
]

describe("searchBm25", () => {
  it("ranks the matching support intent first", () => {
    const index = buildBm25(entries)
    const hits = searchBm25(index, "where is my order tracking number", 3)
    expect(hits[0]?.intent).toBe("track_order")
    expect(hits[0]?.score).toBeGreaterThan(hits[1]?.score ?? 0)
  })
})
