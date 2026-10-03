"use client"

import { useCallback, useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { UsageResponse } from "@/lib/api-types"

export function UsageDashboard() {
  const [data, setData] = useState<UsageResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch("/api/v1/usage", { cache: "no-store" })
      const body = (await response.json()) as UsageResponse & { message?: string }
      if (!response.ok) {
        setError(body.message ?? "Usage is unavailable.")
        setData(null)
        return
      }
      setData(body)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Usage is unavailable.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Usage</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Requests and estimated cost for the current UTC day, plus the tokens still left on each tenant.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      {error ? (
        <Card>
          <CardContent>
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      ) : null}

      {loading && !data ? <p className="text-sm text-muted-foreground">Loading today&apos;s meter…</p> : null}

      {data ? (
        <>
          <p className="metric text-xs text-muted-foreground">
            Period {data.period} · resets {new Date(data.resetsAt).toLocaleString()}
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {data.tenants.map((tenant) => (
              <Card key={tenant.id}>
                <CardHeader>
                  <CardTitle>{tenant.name}</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-2 text-sm">
                  <Meter label="Plan" value={tenant.plan} />
                  <Meter label="Requests" value={String(tenant.requests)} />
                  <Meter label="Cost" value={formatUsd(tenant.costUsd)} />
                  <Meter
                    label="Tokens"
                    value={`${tenant.usedTokens.toLocaleString()} used · ${tenant.reservedTokens.toLocaleString()} reserved`}
                  />
                  <Meter
                    label="Remaining"
                    value={`${tenant.remainingTokens.toLocaleString()} of ${tenant.quotaTokens.toLocaleString()}`}
                  />
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary"
                      style={{
                        width: `${Math.min(100, ((tenant.usedTokens + tenant.reservedTokens) / Math.max(1, tenant.quotaTokens)) * 100)}%`,
                      }}
                    />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Recent requests</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {data.tenants.every((tenant) => tenant.recent.length === 0) ? (
                <p className="text-sm text-muted-foreground">No requests in this period yet.</p>
              ) : (
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-3 font-medium">When</th>
                      <th className="py-2 pr-3 font-medium">Tenant</th>
                      <th className="py-2 pr-3 font-medium">Outcome</th>
                      <th className="py-2 pr-3 font-medium">Model</th>
                      <th className="py-2 pr-3 font-medium">Intent</th>
                      <th className="py-2 pr-3 font-medium">Tokens</th>
                      <th className="py-2 pr-3 font-medium">Latency</th>
                      <th className="py-2 font-medium">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.tenants.flatMap((tenant) =>
                      tenant.recent.map((request) => (
                        <tr key={request.id} className="border-t border-border align-top">
                          <td className="metric py-2 pr-3 text-xs">{new Date(request.createdAt).toLocaleTimeString()}</td>
                          <td className="py-2 pr-3">{tenant.name}</td>
                          <td className="py-2 pr-3">
                            <Badge variant={badgeFor(request.outcome)}>{request.outcome}</Badge>
                            {request.fallbackFired ? (
                              <div className="metric mt-1 text-[11px] text-muted-foreground">
                                {request.attempts.map((attempt) => `${attempt.backend}:${attempt.status}`).join(" → ")}
                              </div>
                            ) : null}
                          </td>
                          <td className="metric py-2 pr-3 text-xs">{request.servedBy ?? "—"}</td>
                          <td className="metric py-2 pr-3 text-xs">{request.intent ?? "—"}</td>
                          <td className="metric py-2 pr-3 text-xs">
                            {request.promptTokens + request.completionTokens}
                          </td>
                          <td className="metric py-2 pr-3 text-xs">{request.latencyMs} ms</td>
                          <td className="metric py-2 text-xs">{formatUsd(request.costUsd)}</td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  )
}

function Meter({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="metric text-xs">{value}</span>
    </div>
  )
}

function badgeFor(outcome: string): "default" | "secondary" | "destructive" | "outline" {
  if (outcome === "ok") return "default"
  if (outcome === "refused") return "secondary"
  if (outcome === "degraded") return "outline"
  return "destructive"
}

function formatUsd(value: number) {
  return value < 0.01 ? `$${value.toFixed(6)}` : `$${value.toFixed(4)}`
}
