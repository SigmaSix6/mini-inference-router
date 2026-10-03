import { isIntentLabel } from "@/lib/intents"

export type OutputAssessment = {
  usable: boolean
  intent: string | null
  answer: string
  usedKnnIntent: boolean
  declined: boolean
  reason: "empty" | "invalid_intent" | "unusable_answer" | "missing_intent" | null
}

export function assessOutput(raw: string, knnIntent: string | null): OutputAssessment {
  const text = raw.replace(/^\uFEFF/, "").trim()
  if (!text) {
    return empty("empty")
  }

  let intent: string | null = null
  let answer = text
  let headerInvalid = false
  const newline = text.indexOf("\n")
  const firstLine = (newline === -1 ? text : text.slice(0, newline)).trim()

  if (firstLine.startsWith("{") && firstLine.endsWith("}")) {
    try {
      const parsed = JSON.parse(firstLine) as { intent?: unknown }
      const value = typeof parsed.intent === "string" ? parsed.intent.trim() : ""
      if (isIntentLabel(value)) intent = value
      else headerInvalid = true
      answer = (newline === -1 ? "" : text.slice(newline + 1)).trim()
    } catch {
      headerInvalid = true
    }
  }

  if (headerInvalid) {
    return {
      usable: false,
      intent: null,
      answer,
      usedKnnIntent: false,
      declined: false,
      reason: "invalid_intent",
    }
  }

  const declined = isDecline(answer)
  const prose = isProse(answer)
  const acceptable = declined || prose

  if (!intent) {
    if (acceptable && knnIntent && isIntentLabel(knnIntent)) {
      return {
        usable: true,
        intent: knnIntent,
        answer,
        usedKnnIntent: true,
        declined,
        reason: null,
      }
    }
    return {
      usable: false,
      intent: null,
      answer,
      usedKnnIntent: false,
      declined,
      reason: acceptable ? "missing_intent" : "unusable_answer",
    }
  }

  if (!acceptable) {
    return {
      usable: false,
      intent,
      answer,
      usedKnnIntent: false,
      declined: false,
      reason: "unusable_answer",
    }
  }

  return {
    usable: true,
    intent,
    answer,
    usedKnnIntent: false,
    declined,
    reason: null,
  }
}

function empty(reason: OutputAssessment["reason"]): OutputAssessment {
  return {
    usable: false,
    intent: null,
    answer: "",
    usedKnnIntent: false,
    declined: false,
    reason,
  }
}

function isProse(answer: string): boolean {
  if (answer.length < 40) return false
  const letters = answer.match(/[A-Za-z]/g)?.length ?? 0
  return letters / answer.length >= 0.5
}

function isDecline(answer: string): boolean {
  return (
    /^(i\s+(do not|don't|dont)\s+know|i\s+cannot|i\s+can't|i\s+can not)\b/i.test(answer.trim()) &&
    answer.length < 400
  )
}
