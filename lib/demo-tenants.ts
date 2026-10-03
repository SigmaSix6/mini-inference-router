export const DEMO_TENANTS = [
  {
    name: "Acme Support",
    apiKey: "mir_demo_acme_7f3a9c2e1b84d056",
    plan: "standard" as const,
    quotaTokens: 2_000_000,
    blurb: "Day-to-day support traffic. The fast model answers unless retrieval is ambiguous or the question is multi-part.",
  },
  {
    name: "Tiny Quota Co",
    apiKey: "mir_demo_tiny_04d8e6a1c93f20ab",
    plan: "standard" as const,
    quotaTokens: 32,
    blurb: "Token budget sits under the reservation floor, so the gateway refuses the call with 429.",
  },
] as const
