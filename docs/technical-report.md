# Technical report

Relay is a Next.js gateway plus a Bitext support assistant. This note covers the routing rules, the model and retrieval choices, how evaluation works, and what was left out.

## Request path

`POST /api/v1/support/chat` does the work in this order:

1. Zod checks the body. A bad body is `400`.
2. The bearer token is SHA-256 hashed and looked up. An unknown key is `401`. If the database cannot answer, the call is `503` and denied.
3. A token reservation is taken in one `UPDATE … WHERE used + reserved + estimate <= limit`. Exhausted quota is `429` with limit, used, reserved, and the next UTC midnight. If that write throws, the response is `503`. Nothing is served.
4. BM25 retrieves five entries. If the top score is under 3.2, query-token coverage is under 0.3, or the blended pre-confidence is under 0.42, the gateway refuses without calling a model. The refusal is still metered.
5. Otherwise a backend chain is chosen and streamed with a 3s time-to-first-token cap and a 12s total cap.
6. The first line must be `{"intent":"<one of 27 labels>"}`. An intent outside that list, or an answer that is not prose, is unusable and the next backend is tried. A missing header with a real paragraph falls back to the kNN intent and lowers confidence. A model that says it does not know, or a final confidence under 0.45, is replaced with the standard refusal.
7. The request row, attempt rows, and quota settlement are written. Cost comes from the price table. Mock usage is estimated (`tokens_estimated=true`). Groq usage is taken from the stream when the provider sends it.

Pre-confidence is `0.5 * min(1, bm25/14) + 0.35 * vote share + 0.15 * margin`. Final confidence is `0.5 * pre + 0.2 * vote share + 0.3 * agreement`, times 0.85 when the intent was filled in from kNN because the model omitted the header.

## Routing

The fast model is the default. It is the cheap, low-latency choice for a short question whose top intent is clear (vote share at least 0.6 and margin at least 0.15).

The quality model is primary when:

- the tenant plan is `quality`
- retrieval is ambiguous
- the message is longer than 320 characters or contains two question marks
- the caller sets `debug.forceTier`

The chain is primary, then the other tier, then the degraded mock when Groq is configured. A failure, a TTFT timeout, a total timeout, or unusable text moves to the next backend. Each attempt is stored (`request_attempts`) and emitted as a `fallback` event. The console shows the trail.

`debug.primaryMode` of `error`, `hang`, or `garbage` forces that behavior on the first backend so the fallback can be demonstrated without waiting on a provider.

## Models

No Groq key is in this environment, so the default backends are mocks:

- `mock-fast` / `mock-llama-8b` returns the first two sentences of the top retrieved answer. Priced at the last public Llama 3.1 8B on-demand rate, $0.05 / $0.08 per million tokens.
- `mock-quality` / `mock-llama-70b` returns the full retrieved answer. Priced at the last public Llama 3.3 70B rate, $0.59 / $0.79 per million.

With `GROQ_API_KEY`, live Groq calls replace the two mocks as the primary chain. The intended ids were `llama-3.1-8b-instant` then `llama-3.3-70b-versatile`, with the brief mock last and labelled degraded. On the free tier those Llama ids return `model_not_found`, so the defaults are Groq's replacements: `openai/gpt-oss-20b` (fast) and `openai/gpt-oss-120b` (quality / escalation), then the mock. The eval configs stay fast versus quality either way.

## Retrieval

The knowledge base is 50 Bitext pairs per intent (1,350 entries) from `bitext/Bitext-customer-support-llm-chatbot-training-dataset`. The split seed is `20261003`. Instructions are normalized (lowercase, placeholders stripped) and de-duplicated. Two rows per intent are held for a dev slice, then 30 stratified rows are held out for eval (one per intent, plus a second row for the first three intents alphabetically). Those instructions are banned from the knowledge base. Five hand-written out-of-scope prompts are added so refusal can be measured. Bitext paraphrases can still sit near a held-out question, so intent accuracy and ROUGE-L will look strong. That is called out here rather than treated as a solved leakage problem.

BM25 indexes the instruction plus the intent words. The response is not indexed, so long template answers do not drown the question. There is no embedding call.

## Evaluation

`npm run eval` posts every case to the running chat endpoint twice, with `debug.forceTier` set to `fast` and `quality`, and `tokenDelayMs` 0. It reports intent accuracy, in-scope refusal rate, mean ROUGE-L against the reference, p50/p95 latency, token totals, cost, and out-of-scope refusal rate. `EVAL_JUDGE=1` plus a Groq key adds a 1–5 factual-overlap score from the quality model. The latest table is `eval/results.md`.

On the mocks, both configs copy retrieved text, so they often tie on intent and differ on completion length, latency, and the 8B versus 70B price. That is a stand-in comparison, not a claim about Llama quality.

The local mock run on 2026-10-03 (`eval/results.md`) scored both configs at 100% intent accuracy and 0% in-scope refusal, with 100% refusal on the five out-of-scope prompts. Mean ROUGE-L was 0.198 on the fast mock and 0.352 on the quality mock. Median latency was 32 ms versus 87 ms, and total held-out cost was $0.002269 versus $0.024215. The judge column is empty until a Groq key is present.

## Cuts

Left out, on purpose:

- Embedding or hybrid retrieval.
- A circuit breaker. Fallback is recorded in Postgres, which survives more than one process. An in-memory breaker would be per instance and was not worth the extra state.
- Deployment. There is no Vercel project, Neon URL, or GitHub remote yet. Local Postgres is the database. Point `DATABASE_URL` at Neon and set `GROQ_API_KEY` when those exist.
- A video.
- Gating the console. It is public, and the two demo keys are in the README and the playground.
- Charging provider-equivalent dollars for a pre-model refusal. Quota tokens are still consumed. USD cost is zero because no model ran.

Debug controls are accepted on the public chat route so the fallback can be shown. They should be admin-only outside this take-home.
