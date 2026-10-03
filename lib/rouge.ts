export function tokenizeRouge(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\{\{[^}]*\}\}/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1)
}

export function rougeL(hypothesis: string, reference: string): number {
  if (!hypothesis || !reference) return 0
  const left = tokenizeRouge(hypothesis)
  const right = tokenizeRouge(reference)
  if (left.length === 0 || right.length === 0) return 0
  const lcs = lcsLength(left, right)
  const precision = lcs / left.length
  const recall = lcs / right.length
  if (precision + recall === 0) return 0
  return (2 * precision * recall) / (precision + recall)
}

function lcsLength(left: string[], right: string[]): number {
  const widths = new Array<number>(right.length + 1).fill(0)
  for (let i = 1; i <= left.length; i += 1) {
    let previous = 0
    for (let j = 1; j <= right.length; j += 1) {
      const current = widths[j]
      if (left[i - 1] === right[j - 1]) widths[j] = previous + 1
      else widths[j] = Math.max(widths[j], widths[j - 1])
      previous = current
    }
  }
  return widths[right.length]
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))
  return sorted[index]
}
