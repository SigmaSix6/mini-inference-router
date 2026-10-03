import { sql } from "drizzle-orm"
import { groqConfigured, getBackends } from "@/lib/backends/registry"
import { getDb } from "@/lib/db/client"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  let database: "ok" | "down" = "down"
  try {
    await getDb().execute(sql`select 1`)
    database = "ok"
  } catch {
    database = "down"
  }
  return Response.json({
    ok: database === "ok",
    database,
    groq: groqConfigured(),
    backends: getBackends().map((backend) => ({
      id: backend.id,
      model: backend.model,
      tier: backend.tier,
      degraded: backend.degraded,
    })),
  })
}
