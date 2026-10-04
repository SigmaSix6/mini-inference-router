# Technical report

Relay is a Next.js gateway plus a Bitext support assistant. The live app is [https://mini-inference-router.vercel.app](https://mini-inference-router.vercel.app). Postgres is Neon project `shiny-brook-20421189`, branch `production`. Chat calls Groq. This note covers the routing rules, the models that actually run, BM25 retrieval, the live eval, and what was left out.

## Request path

`POST /api/v1/support/chat` does the work in this order:

1. Zod checks the body. A bad body is `400`.
2. The bearer token is SHA-256 hashed and looked up. An unknown key is `401`. If the database cannot answer, the call is `503` and denied.
3. A token reservation is taken in one `UPDATE … WHERE used + reserved + estimate <= limit`. Exhausted quota is `429` with limit, used, reserved, and the next UTC midnight. If that write throws, the response is `503`. Nothing is served.
4. BM25 retrieves five entries. If the top score is under 3.2, query-token coverage is under 0.3, or the blended pre-confidence is under 0.42, the gateway refuses without calling a model. The refusal is still metered. USD cost is zero because no model ran.
5. Otherwise a backend chain is chosen and streamed with a 3s time-to-first-token cap and a 12s total cap.
6. The first line must be `{"intent":"<one of 27 labels>"}`. An intent outside that list, or an answer that is not prose, is unusable and the next backend is tried. A missing header with a real paragraph falls back to the kNN intent and lowers confidence. A model that says it does not know, or a final confidence under 0.45, is replaced with the standard refusal.
7. The request row, attempt rows, and quota settlement are written to Neon. Cost comes from the price table. Mock usage is estimated (`tokens_estimated=true`). Groq usage is taken from the stream when the provider sends it.

Pre-confidence is `0.5 * min(1, bm25/14) + 0.35 * vote share + 0.15 * margin`. Final confidence is `0.5 * pre + 0.2 * vote share + 0.3 * agreement`, times 0.85 when the intent was filled in from kNN because the model omitted the header.

## Routing

The fast model is the default. It is the cheap, low-latency choice for a short question whose top intent is clear (vote share at least 0.6 and margin at least 0.15).

The quality model is primary when:

- the tenant plan is `quality`
- retrieval is ambiguous
- the message is longer than 320 characters or contains two question marks
- the caller sets `debug.forceTier`

The chain is primary, then the other tier, then the degraded mock. A failure, a TTFT timeout, a total timeout, or unusable text moves to the next backend. Each attempt is stored (`request_attempts`) and emitted as a `fallback` event. The console shows the trail.

`debug.primaryMode` of `error`, `hang`, or `garbage` forces that behavior on the first backend so the fallback can be demonstrated without waiting on a provider. `debug.forceTier` and `debug.tokenDelayMs` are accepted on the same public route.

## Models

Live Groq calls are on. The intended ids were `llama-3.1-8b-instant` (fast) and `llama-3.3-70b-versatile` (quality). On this key those Llama ids return `model_not_found`. The deployed backends are the free-tier replacements:

- `groq-fast` / `openai/gpt-oss-20b`, priced at $0.075 / $0.30 per million tokens
- `groq-quality` / `openai/gpt-oss-120b`, priced at $0.15 / $0.60 per million tokens
- `mock-fast` / `mock-llama-8b` last, labelled degraded, used only if both Groq calls fail

The health check on the deployed app reports those three backends and `groq: true`. Without `GROQ_API_KEY`, the process falls back to two mocks (`mock-llama-8b` returns the first two sentences of the top hit; `mock-llama-70b` returns the full entry). That path is not what production is running.

## Retrieval

The knowledge base is 50 Bitext pairs per intent (1,350 entries) from `bitext/Bitext-customer-support-llm-chatbot-training-dataset`. The split seed is `20261003`. Instructions are normalized (lowercase, placeholders stripped) and de-duplicated. Two rows per intent are held for a dev slice, then 30 stratified rows are held out for eval (one per intent, plus a second row for the first three intents alphabetically). Those instructions are banned from the knowledge base. Five hand-written out-of-scope prompts are added so refusal can be measured. Bitext paraphrases can still sit near a held-out question, so intent accuracy can look strong. That is leakage from near-duplicate wording, not a solved retrieval problem.

BM25 indexes the instruction plus the intent words. The response is not indexed, so long template answers do not drown the question. There is no embedding call.

## Evaluation

`npm run eval` posts every case to the chat endpoint twice, with `debug.forceTier` set to `fast` and `quality`, and `tokenDelayMs` 0. The base URL is `EVAL_BASE_URL` (default `http://127.0.0.1:43123`). The tenant key is `EVAL_API_KEY` (default the first demo tenant, Acme Support). `EVAL_JUDGE=1` plus `GROQ_API_KEY` adds a 1–5 factual-overlap score from the quality model. `EVAL_GAP_MS` pauses between cases and between judge calls. A case whose attempt error is a Groq 429 is retried with backoff so a free-tier token burst does not get recorded as a model failure.

The live run on 2026-10-04 used `https://mini-inference-router.vercel.app`, the Acme key (`mir_demo_acme_7f3a9c2e1b84d056`, 2,000,000 tokens per UTC day), `EVAL_JUDGE=1`, and a 10s gap. The judge was `openai/gpt-oss-120b`. Config names still say `fast-8b-class` and `quality-70b-class` because those were the original slots; both columns below are the GPT-OSS models above. The table is `eval/results.md`.

| Config | Served by | Intent accuracy | In-scope refusal | Mean ROUGE-L | Judge | p50 ms | p95 ms | Cost USD | Prompt tokens | Completion tokens | Out-of-scope refusal |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| fast-8b-class | groq-fast (openai/gpt-oss-20b) 29/30; groq-quality (openai/gpt-oss-120b) 1/30 | 100.0% | 0.0% | 0.344 | 3.90 | 2307 | 3665 | 0.004762 | 30885 | 7532 | 100.0% (5) |
| quality-70b-class | groq-quality (openai/gpt-oss-120b) | 100.0% | 0.0% | 0.347 | 3.90 | 2609 | 3228 | 0.008860 | 30885 | 7045 | 100.0% (5) |

What the columns measure, on the 30 held-out cases unless noted:

- **Served by** is the backend that produced the answer. Fast stayed on `openai/gpt-oss-20b` for 29 of 30 cases. One case failed over to `openai/gpt-oss-120b`. Quality stayed on `openai/gpt-oss-120b` for all 30. The 10s client gap is not part of the latency.
- **Intent accuracy** is the share of held-out cases that were not refused and whose intent matched the label. 100% means all 30 matched. Near-duplicate Bitext wording in the knowledge base makes that easier than a truly unseen question.
- **In-scope refusal** is the share of held-out cases the gateway refused. 0% means it answered every held-out case.
- **Mean ROUGE-L** is token-overlap F1 against the Bitext reference, averaged over answered held-out cases. 0.344 and 0.347 mean the models paraphrase the reference rather than copy it. The two sizes barely separate. On the earlier mock run, quality copied the full retrieved entry (0.352) and fast copied two sentences (0.198), so that gap was the mock, not the live models.
- **Judge** is the mean 1–5 factual-overlap score from `openai/gpt-oss-120b`. 3.90 on both configs is “most of the same facts,” and it does not prefer the larger model on this set.
- **p50 / p95** are end-to-end latencies for held-out calls. Median is 2.3s on fast and 2.6s on quality. The fast tail (3.7s) is wider, which fits the one failover plus the slower 20b generations.
- **Cost USD** is the sum of held-out request costs from the price table. Prompt tokens are identical (30,885) because both configs see the same retrieved context. Quality costs about 1.9× as much ($0.008860 vs $0.004762) because its token price is higher, even though it emitted fewer completion tokens (7,045 vs 7,532).
- **Out-of-scope refusal** is the five hand-written prompts that are not in the 27 intents. Both configs refused all five.

No rate-limit retry fired during this run. The gap was there so Groq’s free-tier token bucket (8,000 tokens) would not turn into 429s and then into fallbacks.

## Cuts

Left out, on purpose:

- Embedding or hybrid retrieval. Ranking is BM25 only.
- A circuit breaker. Fallback is recorded in Neon, which survives more than one process. An in-memory breaker would be per instance and was not worth the extra state.
- Gating the console. The playground and usage view are public, and the two demo keys are in the README.
- Locking down debug controls. `debug.forceTier`, `debug.primaryMode`, and `debug.tokenDelayMs` are accepted on the public chat route so the fallback can be shown. They should be admin-only outside this take-home.
