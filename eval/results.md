# Eval results

Ran against http://127.0.0.1:43123 on 2026-10-03T02:39:17.821Z.
No GROQ_API_KEY was set. Fast and quality configs used the mock Llama 8B and Llama 70B stand-ins. The mock copies a retrieved Bitext answer (two sentences on fast, the full entry on quality), so intent accuracy mostly measures BM25, and cost and latency reflect the price table plus simulated time-to-first-token. Run again with a key for real generations.

Answer quality is mean ROUGE-L F1 against the held-out reference. An LLM judge (1–5, quality model, fixed rubric) runs only when both `GROQ_API_KEY` and `EVAL_JUDGE=1` are set.

| Config | Served by | Intent accuracy | In-scope refusal | Mean ROUGE-L | Judge | p50 ms | p95 ms | Cost USD | Prompt tokens | Completion tokens | Out-of-scope refusal |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| fast-8b-class | mock-fast (mock-llama-8b) | 100.0% | 0.0% | 0.198 | — | 32 | 37 | 0.002269 | 34872 | 1357 | 100.0% (5) |
| quality-70b-class | mock-quality (mock-llama-70b) | 100.0% | 0.0% | 0.352 | — | 87 | 89 | 0.024215 | 34872 | 4608 | 100.0% (5) |

