export const INTENT_LABELS = [
  "cancel_order",
  "change_order",
  "change_shipping_address",
  "check_cancellation_fee",
  "check_invoice",
  "check_payment_methods",
  "check_refund_policy",
  "complaint",
  "contact_customer_service",
  "contact_human_agent",
  "create_account",
  "delete_account",
  "delivery_options",
  "delivery_period",
  "edit_account",
  "get_invoice",
  "get_refund",
  "newsletter_subscription",
  "payment_issue",
  "place_order",
  "recover_password",
  "registration_problems",
  "review",
  "set_up_shipping_address",
  "switch_account",
  "track_order",
  "track_refund",
] as const

export type IntentLabel = (typeof INTENT_LABELS)[number]

const INTENT_SET = new Set<string>(INTENT_LABELS)

export function isIntentLabel(value: string): value is IntentLabel {
  return INTENT_SET.has(value)
}

export const REFUSAL_TEXT =
  "I don't have a confident answer for that in the support knowledge base. Try asking about an order, delivery, payment, refund, or account, or ask to speak with a person."
