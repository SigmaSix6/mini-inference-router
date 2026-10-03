import { describe, expect, it } from "vitest"
import { reserveQuota, type QuotaStore } from "@/lib/quota"

const input = {
  tenantId: "tenant-1",
  period: "2026-10-03",
  estimate: 2400,
  limit: 32,
}

describe("reserveQuota", () => {
  it("fails closed when the quota store throws", async () => {
    const store: QuotaStore = {
      async tryReserve() {
        throw new Error("connection refused")
      },
      async settle() {
        throw new Error("connection refused")
      },
    }
    const result = await reserveQuota(store, input)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(503)
      expect(result.body.error).toBe("quota_unavailable")
    }
  })

  it("returns 429 with limit, used, and reset when the budget is exhausted", async () => {
    const store: QuotaStore = {
      async tryReserve() {
        return { reserved: false, used: 32, reservedTokens: 0 }
      },
      async settle() {},
    }
    const result = await reserveQuota(store, input)
    expect(result.ok).toBe(false)
    if (!result.ok && result.status === 429) {
      expect(result.body.limit).toBe(32)
      expect(result.body.used).toBe(32)
      expect(result.body.reserved).toBe(0)
      expect(result.body.resets_at).toBe("2026-10-04T00:00:00.000Z")
      expect(result.body.error).toBe("quota_exceeded")
    } else {
      throw new Error("expected quota_exceeded")
    }
  })

  it("reserves when the store accepts the estimate", async () => {
    const store: QuotaStore = {
      async tryReserve() {
        return { reserved: true }
      },
      async settle() {},
    }
    const result = await reserveQuota(store, { ...input, limit: 100_000 })
    expect(result).toEqual({ ok: true })
  })
})
