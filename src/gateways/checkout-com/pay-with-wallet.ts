import type { PaymentSetting, PaymentWallet } from "@commercelayer/sdk"
import { type PaymentClient, pollAuthorization } from "@/lib/payments"
import { checkoutComReturnUrls } from "./redirect-return"

/**
 * Pays with a card the customer stored with Checkout.com earlier.
 *
 * The session is created with the `payment_wallet` relationship and no
 * payment id in `client_data`: CL then submits the payment to Checkout.com
 * itself, with the wallet's stored source and Checkout.com customer. Flow
 * never mounts, but CL still creates a Checkout.com payment session for the
 * session, so the return URLs it requires go in `client_data` all the same.
 *
 * The authorization is polled until it settles. A customer-initiated payment
 * runs 3-D Secure, and Checkout.com asks for it on its own page even when the
 * issuer lets the card through without a challenge: the authorization then
 * waits in `requires_action` with a redirect URL. The shopper goes there and
 * comes back to `success_url` or `failure_url`, where `redirect-return.ts`
 * waits for the webhook to settle the authorization.
 */
export async function payWithCheckoutComWallet({
  client,
  orderId,
  wallet,
  setting,
  amountCents,
  authorizeGiftCards,
}: {
  client: PaymentClient
  orderId: string
  wallet: PaymentWallet
  setting: PaymentSetting
  amountCents: number
  authorizeGiftCards: () => Promise<void>
}): Promise<void> {
  if (!wallet.payment_token) throw new Error("This saved card can't be used.")

  const session = await client.payment_sessions.create({
    amount_cents: amountCents,
    payment_setting: client.payment_settings.relationship(setting.id),
    order: client.orders.relationship(orderId),
    client_data: checkoutComReturnUrls(orderId),
    payment_wallet: client.payment_wallets.relationship(wallet.id),
  })

  const created = await client.payment_authorizations.create({
    payment_session: client.payment_sessions.relationship(session.id),
  })
  const auth = await pollAuthorization(client, created.id)
  const redirectUrl = auth.next_action_data?.redirect_url
  if (auth.status === "requires_action" && typeof redirectUrl === "string") {
    window.location.assign(redirectUrl)
    // The page is leaving: keep the caller's "Paying…" state until it does.
    return new Promise<void>(() => {})
  }
  if (auth.status === "pending") {
    throw new Error(
      "The payment could not be confirmed. Please try again in a moment.",
    )
  }
  if (auth.status !== "succeeded") {
    throw new Error("The saved card was declined. Try another card.")
  }
  // Only now: CL submits the payment, so this is the first point where a gift
  // card can be debited without risking a declined card.
  await authorizeGiftCards()
}
