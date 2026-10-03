import { config } from "dotenv"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"

config({ path: ".env.local" })

const url = process.env.DATABASE_URL
if (!url) {
  console.error("DATABASE_URL is not set")
  process.exit(1)
}

const client = postgres(url, { max: 1 })
const db = drizzle(client)

async function main() {
  await migrate(db, { migrationsFolder: "./drizzle" })
  await client.end()
  console.log("migrations applied")
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
