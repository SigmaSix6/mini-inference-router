# Eval results

Ran against https://mini-inference-router.vercel.app on 2026-10-04T07:36:15.773Z.
Groq was configured, so these numbers are live model calls.

Answer quality is mean ROUGE-L F1 against the held-out reference. An LLM judge (1–5, quality model, fixed rubric) runs only when both `GROQ_API_KEY` and `EVAL_JUDGE=1` are set.

| Config | Served by | Intent accuracy | In-scope refusal | Mean ROUGE-L | Judge | p50 ms | p95 ms | Cost USD | Prompt tokens | Completion tokens | Out-of-scope refusal |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| fast-8b-class | groq-fast (openai/gpt-oss-20b) 29/30; groq-quality (openai/gpt-oss-120b) 1/30 | 100.0% | 0.0% | 0.344 | 3.90 | 2307 | 3665 | 0.004762 | 30885 | 7532 | 100.0% (5) |
| quality-70b-class | groq-quality (openai/gpt-oss-120b) | 100.0% | 0.0% | 0.347 | 3.90 | 2609 | 3228 | 0.008860 | 30885 | 7045 | 100.0% (5) |

