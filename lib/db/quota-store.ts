import { sql } from "drizzle-orm"
import type { QuotaStore, ReserveResult } from "@/lib/quota"
import { getDb, type Database } from "@/lib/db/client"

function asRows(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[]
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows
    if (Array.isArray(rows)) return rows as Record<string, unknown>[]
  }
  return []
}

export function createDbQuotaStore(db: Database = getDb()): QuotaStore {
  return {
    async tryReserve(input): Promise<ReserveResult> {
      return db.transaction(async (tx) => {
        await tx.execute(sql`
          INSERT INTO quota_usage (tenant_id, period, used_tokens, reserved_tokens)
          VALUES (${input.tenantId}, ${input.period}, 0, 0)
          ON CONFLICT (tenant_id, period) DO NOTHING
        `)
        const updated = asRows(await tx.execute(sql`
          UPDATE quota_usage
          SET reserved_tokens = reserved_tokens + ${input.estimate}
          WHERE tenant_id = ${input.tenantId}
            AND period = ${input.period}
            AND used_tokens + reserved_tokens + ${input.estimate} <= ${input.limit}
          RETURNING used_tokens, reserved_tokens
        `))
        if (updated.length > 0) return { reserved: true }
        const current = asRows(await tx.execute(sql`
          SELECT used_tokens, reserved_tokens
          FROM quota_usage
          WHERE tenant_id = ${input.tenantId} AND period = ${input.period}
        `))
        return {
          reserved: false,
          used: Number(current[0]?.used_tokens ?? 0),
          reservedTokens: Number(current[0]?.reserved_tokens ?? 0),
        }
      })
    },
    async settle(input) {
      await db.execute(sql`
        UPDATE quota_usage
        SET used_tokens = used_tokens + ${input.actual},
            reserved_tokens = GREATEST(0, reserved_tokens - ${input.reserved})
        WHERE tenant_id = ${input.tenantId} AND period = ${input.period}
      `)
    },
  }
}
