import { resetsAtIso } from "@/lib/period"

export type ReserveResult = { reserved: true } | { reserved: false; used: number; reservedTokens: number }

export interface QuotaStore {
  tryReserve(input: {
    tenantId: string
    period: string
    estimate: number
    limit: number
  }): Promise<ReserveResult>
  settle(input: { tenantId: string; period: string; actual: number; reserved: number }): Promise<void>
}

export type QuotaExceededBody = {
  error: "quota_exceeded"
  message: string
  limit: number
  used: number
  reserved: number
  resets_at: string
}

export type QuotaUnavailableBody = {
  error: "quota_unavailable"
  message: string
}

export async function reserveQuota(
  store: QuotaStore,
  input: { tenantId: string; period: string; estimate: number; limit: number },
): Promise<
  | { ok: true }
  | { ok: false; status: 429; body: QuotaExceededBody }
  | { ok: false; status: 503; body: QuotaUnavailableBody }
> {
  try {
    const result = await store.tryReserve(input)
    if (!result.reserved) {
      return {
        ok: false,
        status: 429,
        body: {
          error: "quota_exceeded",
          message: "Token quota is exhausted for this period. The request was denied.",
          limit: input.limit,
          used: result.used,
          reserved: result.reservedTokens,
          resets_at: resetsAtIso(input.period),
        },
      }
    }
    return { ok: true }
  } catch {
    return {
      ok: false,
      status: 503,
      body: {
        error: "quota_unavailable",
        message: "Quota store is unavailable. The request was denied.",
      },
    }
  }
}
