import { createHash } from "node:crypto"
import { eq } from "drizzle-orm"
import { getDb } from "@/lib/db/client"
import { tenants } from "@/lib/db/schema"

export function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex")
}

export async function findTenantByKey(apiKey: string) {
  try {
    const hash = hashApiKey(apiKey)
    const [tenant] = await getDb().select().from(tenants).where(eq(tenants.apiKeyHash, hash)).limit(1)
    return { ok: true as const, tenant: tenant ?? null }
  } catch {
    return { ok: false as const, tenant: null }
  }
}
