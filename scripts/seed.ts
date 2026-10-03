import { config } from "dotenv"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import { hashApiKey } from "../lib/auth"
import { DEMO_TENANTS } from "../lib/demo-tenants"
import { tenants } from "../lib/db/schema"

config({ path: ".env.local" })

const url = process.env.DATABASE_URL
if (!url) {
  console.error("DATABASE_URL is not set")
  process.exit(1)
}

const client = postgres(url, { max: 1 })
const db = drizzle(client)

async function main() {
  for (const tenant of DEMO_TENANTS) {
    const apiKeyHash = hashApiKey(tenant.apiKey)
    const [existing] = await db.select().from(tenants).where(eq(tenants.name, tenant.name)).limit(1)
    if (existing) {
      await db
        .update(tenants)
        .set({ apiKeyHash, plan: tenant.plan, quotaTokens: tenant.quotaTokens })
        .where(eq(tenants.id, existing.id))
      console.log(`updated ${tenant.name}`)
    } else {
      await db.insert(tenants).values({
        name: tenant.name,
        apiKeyHash,
        plan: tenant.plan,
        quotaTokens: tenant.quotaTokens,
      })
      console.log(`inserted ${tenant.name}`)
    }
    console.log(`  key ${tenant.apiKey}`)
    console.log(`  quota ${tenant.quotaTokens} tokens / UTC day`)
  }
  await client.end()
}

main().catch(async (error) => {
  console.error(error)
  await client.end()
  process.exit(1)
})
