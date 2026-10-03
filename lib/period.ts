export function utcPeriod(now = new Date()): string {
  return now.toISOString().slice(0, 10)
}

export function resetsAtIso(period: string): string {
  const [year, month, day] = period.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString()
}
