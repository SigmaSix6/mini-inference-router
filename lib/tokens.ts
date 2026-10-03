export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.max(1, Math.ceil(text.length / 4))
}

export function reservationEstimate(message: string): number {
  return estimateTokens(message) + 2400
}
