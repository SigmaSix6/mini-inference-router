import { openSupportChat } from "@/lib/pipeline"
import { chatBodySchema } from "@/lib/chat-schema"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return Response.json(
      { error: "invalid_request", message: "Body must be JSON." },
      { status: 400 },
    )
  }

  const parsed = chatBodySchema.safeParse(payload)
  if (!parsed.success) {
    return Response.json(
      {
        error: "invalid_request",
        message: "Invalid chat request.",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    )
  }

  const header = request.headers.get("authorization") ?? ""
  const match = header.match(/^Bearer\s+(\S+)\s*$/i)
  if (!match) {
    return Response.json(
      { error: "unauthorized", message: "Send the tenant API key as a Bearer token." },
      { status: 401 },
    )
  }

  const result = await openSupportChat({
    apiKey: match[1],
    message: parsed.data.message,
    debug: parsed.data.debug,
  })
  if (result.kind === "json") {
    return Response.json(result.body, { status: result.status })
  }
  return new Response(result.stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
