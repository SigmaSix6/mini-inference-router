"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState, type ReactNode } from "react"
import { cn } from "cn"

export function SiteHeader() {
  const pathname = usePathname()
  const [groq, setGroq] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/health")
      .then((response) => response.json())
      .then((body: { groq?: boolean }) => {
        if (!cancelled) setGroq(Boolean(body.groq))
      })
      .catch(() => {
        if (!cancelled) setGroq(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <header className="border-b border-border bg-card/80">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-6">
          <Link href="/" className="group">
            <div className="text-sm font-semibold tracking-[0.18em]">RELAY</div>
            <div className="text-xs text-muted-foreground">Support inference router</div>
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <NavLink href="/" active={pathname === "/"}>
              Playground
            </NavLink>
            <NavLink href="/usage" active={pathname.startsWith("/usage")}>
              Usage
            </NavLink>
          </nav>
        </div>
        <div className="metric text-[11px] uppercase tracking-wide text-muted-foreground">
          {groq === null ? "Checking backends" : groq ? "Groq live" : "Mock backends"}
        </div>
      </div>
    </header>
  )
}

function NavLink({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: ReactNode
}) {
  return (
    <Link
      href={href}
      className={cn(
        "rounded-md px-2.5 py-1",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </Link>
  )
}
