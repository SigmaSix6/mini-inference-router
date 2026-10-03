# Relay

A small inference router for a customer-support assistant. It authenticates a tenant API key, reserves a token quota, retrieves Bitext answers with BM25, streams a reply from a fast or quality model, and falls back when a backend errors, hangs, or returns unusable text. Every request is metered in Postgres.

Without `GROQ_API_KEY`, two in-process mocks stand in for Llama 8B (fast, brief answer) and Llama 70B (quality, full retrieved answer). Set the key and the same route calls Groq.

## Run locally

Requirements: Node 22, Postgres 16.

```bash
cp .env.example .env.local
# edit DATABASE_URL if your Postgres user differs
npm install
npm run db:setup
npm run dev
```

The dev server listens on `0.0.0.0:43123`.

Open [http://127.0.0.1:43123](http://127.0.0.1:43123) for the playground and [http://127.0.0.1:43123/usage](http://127.0.0.1:43123/usage) for per-tenant usage.

Postgres on this machine was created as:

```text
user mir / password mir / database mini_inference_router
```

`npm run data:prepare` rebuilds `data/kb.json`, `data/eval.json`, and `data/dev.json` from the Bitext CSV (`BITEXT_CSV`, default `/tmp/bitext.csv`). The committed JSON is already split, so you do not need the CSV to run the app.

## Demo tenants

Keys are hashed in the database. These plaintext keys are the demo credentials:

| Tenant | Key | Quota |
| --- | --- | --- |
| Acme Support | `mir_demo_acme_7f3a9c2e1b84d056` | 2,000,000 tokens / UTC day |
| Tiny Quota Co | `mir_demo_tiny_04d8e6a1c93f20ab` | 32 tokens / UTC day |

Tiny Quota Co is below the reservation floor, so its first call returns 429.

## API

`POST /api/v1/support/chat` with `Authorization: Bearer <key>` and `{"message":"..."}`.

Success is server-sent events: `meta`, `token`, `fallback`, `reset`, `done`, `error`.

Failures before the stream:

- `400` invalid body
- `401` missing or unknown key
- `429` `quota_exceeded` with `limit`, `used`, `reserved`, `resets_at`
- `503` quota or auth store unavailable (the call is denied)

`GET /api/v1/requests/:id` returns the stored meter and attempt trail. `GET /api/v1/usage` returns today's tenants. `GET /api/health` reports the database and which backends are active.

```bash
curl -N http://127.0.0.1:43123/api/v1/support/chat \
  -H "Authorization: Bearer mir_demo_acme_7f3a9c2e1b84d056" \
  -H "Content-Type: application/json" \
  -d '{"message":"How do I track order {{Order Number}}?"}'

curl -s http://127.0.0.1:43123/api/v1/support/chat \
  -H "Authorization: Bearer mir_demo_tiny_04d8e6a1c93f20ab" \
  -H "Content-Type: application/json" \
  -d '{"message":"How do I track order {{Order Number}}?"}'
```

To record a fallback, set `debug.primaryMode` to `error`, `hang`, or `garbage`. `debug.forceTier` is `fast` or `quality`.

## Evaluation

```bash
npm test
npm run eval
```

`npm run eval` calls the running server twice over the 30 held-out Bitext cases plus 5 out-of-scope prompts, once forced onto the fast backend and once onto the quality backend. It writes `eval/results.md` with intent accuracy, ROUGE-L, latency, and cost. Set `EVAL_JUDGE=1` along with `GROQ_API_KEY` to add a 1–5 judge score from the quality model.

## Models

| Role | Mock id | Live Groq id (default) |
| --- | --- | --- |
| Fast, 8B-class | `mock-llama-8b` | `openai/gpt-oss-20b` |
| Quality, 70B-class | `mock-llama-70b` | `openai/gpt-oss-120b` |

With a key, the chain is the fast Groq model, then the quality Groq model, then the mock. `llama-3.1-8b-instant` and `llama-3.3-70b-versatile` return `model_not_found` on the free tier, so the live ids are Groq's replacements. Set `GROQ_FAST_MODEL` and `GROQ_QUALITY_MODEL` to switch. See `docs/technical-report.md`.
