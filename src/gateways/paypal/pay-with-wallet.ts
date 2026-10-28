import type { PaymentSetting, PaymentWallet } from "@commercelayer/sdk"
import { type PaymentClient, pollAuthorization } from "@/lib/payments"

/**
 * Pays with a PayPal account the customer stored earlier.
 *
 * The session is created with the `payment_wallet` relationship. CL builds the
 * PayPal order from the wallet's vault token, so PayPal processes it straight
 * away: there is no button and no PayPal window, since the shopper approved
 * future payments when the account was stored. The CL authorization then
 * records the PayPal authorization, and is polled until it settles.
 */
export async function payWithPayPalWallet({
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
  const session = await client.payment_sessions.create({
    amount_cents: amountCents,
    payment_setting: client.payment_settings.relationship(setting.id),
    order: client.orders.relationship(orderId),
    payment_wallet: client.payment_wallets.relationship(wallet.id),
  })

  await authorizeGiftCards()
  const created = await client.payment_authorizations.create({
    payment_session: client.payment_sessions.relationship(session.id),
  })
  const auth = await pollAuthorization(client, created.id)
  if (auth.status === "pending") {
    throw new Error(
      "The payment could not be confirmed. Please try again in a moment.",
    )
  }
  if (auth.status !== "succeeded") {
    throw new Error("PayPal declined the payment.")
  }
}
