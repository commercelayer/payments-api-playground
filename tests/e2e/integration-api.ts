import { authenticate } from "@commercelayer/js-auth"
import { CommerceLayer } from "@commercelayer/sdk"
import { ENV } from "varlock/env"

async function integrationClient() {
  const clientId = ENV.CL_INTEGRATION_CLIENT_ID
  const clientSecret = ENV.CL_INTEGRATION_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing CL_INTEGRATION_CLIENT_ID / CL_INTEGRATION_CLIENT_SECRET",
    )
  }
  const auth = await authenticate("client_credentials", {
    clientId,
    clientSecret,
    domain: ENV.CL_DOMAIN,
  })
  return CommerceLayer({
    accessToken: auth.accessToken,
    apiVersion: "2026-05",
  })
}

/**
 * Reads an order through an integration token, which sees what the storefront
 * token may not — e.g. a subscription a trigger created behind the checkout's
 * back. Returns both sides of the order's subscription relationship and the
 * line-item frequencies, which is everything that marks an order as taking
 * part in a subscription.
 */
export async function fetchOrderSubscriptionState(orderId: string) {
  const client = await integrationClient()
  const order = await client.orders.retrieve(orderId, {
    include: ["order_subscriptions", "order_subscription", "line_items"],
  })
  return {
    status: order.status,
    seededSubscriptions: order.order_subscriptions ?? [],
    generatedBy: order.order_subscription ?? null,
    frequencies: (order.line_items ?? [])
      .map((li) => li.frequency)
      .filter(Boolean),
  }
}

/**
 * The payment_wallet linked to one of the order's payment sessions, or null
 * when none is. CL links it while processing the authorization of a session
 * that asked to store the card, whether it creates a wallet or reuses the
 * customer's existing one for the same card or account.
 */
export async function fetchOrderWalletId(
  orderId: string,
): Promise<string | null> {
  const client = await integrationClient()
  const order = await client.orders.retrieve(orderId, {
    include: ["payment_sessions.payment_wallet"],
  })
  const session = (order.payment_sessions ?? []).find((s) => s.payment_wallet)
  return session?.payment_wallet?.id ?? null
}

/**
 * Cancels what the e2e customer (`CL_CUSTOMER_EMAIL`) gained since `since`:
 * order subscriptions first, so none is left to renew with a wallet about to
 * go, then payment wallets. A record the API refuses to cancel doesn't stop
 * the others: it is reported in `failed` with the API's reason.
 */
export async function cancelCustomerDataSince(since: Date): Promise<{
  subscriptions: number
  wallets: number
  failed: string[]
}> {
  const email = ENV.CL_CUSTOMER_EMAIL
  if (!email) throw new Error("Missing CL_CUSTOMER_EMAIL")
  const client = await integrationClient()
  const [customer] = await client.customers.list({
    filters: { email_eq: email },
  })
  const result = { subscriptions: 0, wallets: 0, failed: [] as string[] }
  if (!customer) return result

  const filters = {
    customer_id_eq: customer.id,
    created_at_gt: since.toISOString(),
  }
  // Collect every id before writing: a cancelled record leaves the filtered
  // list, which would shift the pages under a loop that cancels as it reads.
  const collect = async (
    list: (
      page: number,
    ) => Promise<{ id: string }[] & { meta: { pageCount: number } }>,
  ) => {
    const ids: string[] = []
    for (let page = 1; ; page++) {
      const records = await list(page)
      ids.push(...records.map((r) => r.id))
      if (page >= records.meta.pageCount) return ids
    }
  }
  const subscriptionIds = await collect((pageNumber) =>
    client.order_subscriptions.list({
      filters: { ...filters, status_not_eq: "cancelled" },
      pageSize: 25,
      pageNumber,
    }),
  )
  const walletIds = await collect((pageNumber) =>
    client.payment_wallets.list({
      filters: { ...filters, status_not_eq: "canceled" },
      pageSize: 25,
      pageNumber,
    }),
  )

  for (const id of subscriptionIds) {
    try {
      await client.order_subscriptions.update({ id, _cancel: true })
      result.subscriptions++
    } catch (error) {
      result.failed.push(`order_subscriptions/${id}: ${reasonOf(error)}`)
    }
  }
  for (const id of walletIds) {
    try {
      await client.payment_wallets.update({ id, _cancel: true })
      result.wallets++
    } catch (error) {
      result.failed.push(`payment_wallets/${id}: ${reasonOf(error)}`)
    }
  }
  return result
}

/** The first error detail of a failed API call, or its message. */
function reasonOf(error: unknown): string {
  const detail = (error as { errors?: { detail?: string }[] }).errors?.[0]
    ?.detail
  return detail ?? (error instanceof Error ? error.message : String(error))
}

/**
 * The order's gift card sessions, each with its authorization status (null
 * when it has none). A gift card is debited the moment it is authorized, so an
 * authorization here means its balance has been spent on this order.
 */
export async function fetchGiftCardSessions(orderId: string) {
  const client = await integrationClient()
  const order = await client.orders.retrieve(orderId, {
    include: [
      "payment_sessions.payment_setting",
      "payment_sessions.payment_authorization",
    ],
  })
  return (order.payment_sessions ?? [])
    .filter((s) => s.payment_setting?.type === "payment_setting_gift_cards")
    .map((s) => ({
      status: s.status,
      authorization: s.payment_authorization?.status ?? null,
    }))
}

/**
 * Raises the quantity of the order's SKU line item until the order total
 * reaches `minCents`. Setting the quantity directly takes one or two writes,
 * where stepping it up from the checkout re-prices the order once per unit.
 *
 * The first estimate uses the unit price without taxes or shipping, so it
 * stays a little short and the loop tops it up a unit at a time. Like any line
 * item write, it clears the shipping method already chosen.
 */
export async function raiseOrderTotalTo(
  orderId: string,
  minCents: number,
): Promise<void> {
  const client = await integrationClient()
  for (;;) {
    const order = await client.orders.retrieve(orderId, {
      include: ["line_items"],
    })
    const total = order.total_amount_with_taxes_cents ?? 0
    if (total >= minCents) return
    const item = order.line_items?.find((li) => li.item_type === "skus")
    if (!item?.unit_amount_cents) {
      throw new Error(`Order ${orderId} has no priced SKU line item.`)
    }
    const missingUnits = Math.max(
      1,
      Math.floor((minCents - total) / item.unit_amount_cents),
    )
    await client.line_items.update({
      id: item.id,
      quantity: item.quantity + missingUnits,
    })
  }
}

/**
 * For each PayPal payment_session of the order, the amount Commerce Layer
 * recorded and the amount PayPal itself authorized, read from the
 * authorization's `response_data` (the PayPal order). Only an integration
 * token sees that data.
 */
export async function fetchPayPalAuthorizedAmounts(
  orderId: string,
): Promise<Array<{ sessionCents: number; paypalCents: number | null }>> {
  const client = await integrationClient()
  const order = await client.orders.retrieve(orderId, {
    include: [
      "payment_sessions",
      "payment_sessions.payment_setting",
      "payment_sessions.payment_authorization",
    ],
  })
  return (order.payment_sessions ?? [])
    .filter((s) => s.payment_setting?.type === "payment_setting_paypals")
    .map((s) => {
      const value =
        s.payment_authorization?.response_data?.purchase_units?.[0]?.payments
          ?.authorizations?.[0]?.amount?.value
      return {
        sessionCents: s.amount_cents ?? 0,
        paypalCents:
          typeof value === "string" ? Math.round(Number(value) * 100) : null,
      }
    })
}
