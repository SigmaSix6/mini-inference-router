import type { Backend, BackendChunk } from "@/lib/backends/types"

type GroqChunk = {
  choices?: Array<{ delta?: { content?: string } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

export function createGroqBackend(options: {
  id: string
  model: string
  tier: "fast" | "quality"
  apiKey: string
}): Backend {
  return {
    id: options.id,
    model: options.model,
    tier: options.tier,
    degraded: false,
    async *stream(request, signal): AsyncIterable<BackendChunk> {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: options.model,
          temperature: 0.2,
          max_tokens: 400,
          stream: true,
          stream_options: { include_usage: true },
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.user },
          ],
        }),
      })
      if (!response.ok || !response.body) {
        const detail = await response.text().catch(() => "")
        throw new Error(`groq ${response.status} ${detail.slice(0, 280)}`)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      let promptTokens = 0
      let completionTokens = 0
      let sawUsage = false

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith("data:")) continue
          const data = trimmed.slice(5).trim()
          if (!data || data === "[DONE]") continue
          let json: GroqChunk
          try {
            json = JSON.parse(data) as GroqChunk
          } catch {
            continue
          }
          const text = json.choices?.[0]?.delta?.content
          if (text) yield { type: "token", text }
          if (json.usage) {
            promptTokens = json.usage.prompt_tokens ?? promptTokens
            completionTokens = json.usage.completion_tokens ?? completionTokens
            sawUsage = true
          }
        }
      }

      if (sawUsage) {
        yield { type: "usage", promptTokens, completionTokens, estimated: false }
      }
    },
  }
}
