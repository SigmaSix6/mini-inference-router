import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "@/lib/db/schema"

export type Database = PostgresJsDatabase<typeof schema>

const globalForDb = globalThis as unknown as {
  pgClient?: ReturnType<typeof postgres>
  db?: Database
}

export function getDb(): Database {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is not set")
  if (!globalForDb.db) {
    const client = postgres(url, { max: 8 })
    globalForDb.pgClient = client
    globalForDb.db = drizzle(client, { schema })
  }
  return globalForDb.db
}
