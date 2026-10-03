import { INTENT_LABELS } from "@/lib/intents"
import type { ScoredEntry } from "@/lib/retrieval/bm25"

export function buildPrompt(message: string, hits: ScoredEntry[]): { system: string; user: string } {
  const system = [
    "You are Relay, a customer support assistant.",
    "Answer only from the retrieved knowledge-base entries.",
    "Preserve template placeholders such as {{Order Number}} when the entries use them.",
    "Do not invent order numbers, policies, or steps that are not in the entries.",
    'The first line must be a JSON object and nothing else: {"intent":"<label>"}.',
    "The intent must be exactly one of the labels below.",
    "Then a blank line, then the customer-facing answer.",
    "If the entries do not support an answer, say you do not know rather than guessing.",
    "",
    `Labels: ${INTENT_LABELS.join(", ")}`,
  ].join("\n")

  const entries =
    hits.length === 0
      ? "(none)"
      : hits
          .map(
            (hit, index) =>
              `${index + 1}. intent=${hit.intent} score=${hit.score.toFixed(2)}\nQ: ${hit.instruction}\nA: ${hit.response}`,
          )
          .join("\n\n")

  const user = `Customer message:\n${message}\n\nRetrieved entries:\n${entries}`
  return { system, user }
}
