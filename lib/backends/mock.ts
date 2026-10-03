import { estimateTokens } from "@/lib/tokens"
import { sleep } from "@/lib/sleep"
import type { Backend, BackendRequest } from "@/lib/backends/types"

function firstSentences(text: string, count: number): string {
  const parts = text
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length === 0) return text.trim()
  return parts.slice(0, count).join(" ")
}

function mockAnswer(request: BackendRequest, style: "brief" | "full"): { intent: string; answer: string } {
  const top = request.retrieved[0]
  const intent = request.knnIntent || top?.intent || "contact_customer_service"
  if (!top) {
    return { intent, answer: "I don't know based on the knowledge base." }
  }
  const answer = style === "brief" ? firstSentences(top.response, 2) : top.response
  return { intent, answer }
}

export function createMockBackend(options: {
  id: string
  model: string
  tier: Backend["tier"]
  degraded?: boolean
  style: "brief" | "full"
  ttftMs: number
}): Backend {
  return {
    id: options.id,
    model: options.model,
    tier: options.tier,
    degraded: options.degraded ?? false,
    async *stream(request, signal) {
      const { intent, answer } = mockAnswer(request, options.style)
      const header = `${JSON.stringify({ intent })}\n\n`
      await sleep(options.ttftMs, signal)
      yield { type: "token", text: header }
      const delay = request.debug?.tokenDelayMs ?? 8
      const size = 64
      for (let index = 0; index < answer.length; index += size) {
        if (delay > 0) await sleep(delay, signal)
        yield { type: "token", text: answer.slice(index, index + size) }
      }
      yield {
        type: "usage",
        promptTokens: estimateTokens(request.system + request.user),
        completionTokens: estimateTokens(header + answer),
        estimated: true,
      }
    },
  }
}
