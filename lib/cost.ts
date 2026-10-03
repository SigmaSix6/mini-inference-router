export type ModelPrice = {
  inputPerMillion: number
  outputPerMillion: number
}

/**
 * Prices are USD per 1M tokens.
 * Llama 8B / 70B figures are Groq's last public on-demand rates, used for the
 * mock stand-ins. GPT-OSS rates are the live free-tier replacements (Oct 2026).
 */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  "mock-llama-8b": { inputPerMillion: 0.05, outputPerMillion: 0.08 },
  "llama-3.1-8b-instant": { inputPerMillion: 0.05, outputPerMillion: 0.08 },
  "mock-llama-70b": { inputPerMillion: 0.59, outputPerMillion: 0.79 },
  "llama-3.3-70b-versatile": { inputPerMillion: 0.59, outputPerMillion: 0.79 },
  "openai/gpt-oss-20b": { inputPerMillion: 0.075, outputPerMillion: 0.3 },
  "openai/gpt-oss-120b": { inputPerMillion: 0.15, outputPerMillion: 0.6 },
}

const FALLBACK_PRICE: ModelPrice = { inputPerMillion: 0.15, outputPerMillion: 0.6 }

export function priceFor(model: string): ModelPrice {
  return MODEL_PRICES[model] ?? FALLBACK_PRICE
}

export function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  const price = priceFor(model)
  const cost =
    (promptTokens / 1_000_000) * price.inputPerMillion +
    (completionTokens / 1_000_000) * price.outputPerMillion
  return Math.round(cost * 1e8) / 1e8
}
