import { createGroqBackend } from "@/lib/backends/groq"
import { createMockBackend } from "@/lib/backends/mock"
import type { Backend } from "@/lib/backends/types"

export const DEFAULT_FAST_MODEL = "openai/gpt-oss-20b"
export const DEFAULT_QUALITY_MODEL = "openai/gpt-oss-120b"

export function groqConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY?.trim())
}

export function getBackends(): Backend[] {
  const apiKey = process.env.GROQ_API_KEY?.trim()
  const fastModel = process.env.GROQ_FAST_MODEL?.trim() || DEFAULT_FAST_MODEL
  const qualityModel = process.env.GROQ_QUALITY_MODEL?.trim() || DEFAULT_QUALITY_MODEL

  if (apiKey) {
    return [
      createGroqBackend({ id: "groq-fast", model: fastModel, tier: "fast", apiKey }),
      createGroqBackend({ id: "groq-quality", model: qualityModel, tier: "quality", apiKey }),
      createMockBackend({
        id: "mock-fast",
        model: "mock-llama-8b",
        tier: "degraded",
        degraded: true,
        style: "brief",
        ttftMs: 20,
      }),
    ]
  }

  return [
    createMockBackend({
      id: "mock-fast",
      model: "mock-llama-8b",
      tier: "fast",
      style: "brief",
      ttftMs: 25,
    }),
    createMockBackend({
      id: "mock-quality",
      model: "mock-llama-70b",
      tier: "quality",
      style: "full",
      ttftMs: 80,
    }),
  ]
}
