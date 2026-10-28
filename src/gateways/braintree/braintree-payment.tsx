"use client"

import { useRef, useState } from "react"
import type { GatewayPaymentProps } from "@/gateways/types"
import { errorMessage, pollAuthorization } from "@/lib/payments"
import { BraintreeDropinStep } from "./dropin-step"
import { BraintreeHostedFieldsStep } from "./hosted-fields-step"

/**
 * Card payment with Braintree, from the shopper's choice to an authorized
 * payment_session.
 *
 * 1. Confirm creates the payment_session. CL asks Braintree for a client token
 *    and returns it in the session's `response_data.clientToken`.
 * 2. Hosted Fields (or the Drop-in UI, a demo toggle) mount on that token and
 *    collect the card. 3-D Secure runs in the browser and turns the card into
 *    a single-use nonce. Both widgets hand back the same kind of nonce.
 * 3. The nonce goes into the session's `client_data.payment_method_id`, where
 *    CL reads it when the authorization runs. Updating the session makes no
 *    gateway call by itself.
 * 4. The CL payment_authorization is created. CL relays it to Braintree
 *    asynchronously, so it is polled until it settles.
 *
 * To store the card, the session is created with `vaulting: true`. CL then
 * authorizes with Braintree's `vaultPaymentMethodAfterTransacting`, so the same
 * 3DS-verified nonce pays the order and is stored only if the payment succeeds,
 * and links the payment_wallet itself from the transaction's payment method and
 * customer. Nothing is written client-side. Hosted Fields has no consent
 * checkbox, so the consent is asked here, as for Stripe; a guest session never
 * vaults, because a wallet needs a customer to belong to.
 */
export function BraintreePayment({
  client,
  orderId,
  setting,
  amountCents,
  customerEmail,
  billingAddress,
  customerId,
  mustSaveCard,
  session,
  onSessionChange,
  authorizeGiftCards,
  onAuthorized,
  onCancel,
}: GatewayPaymentProps) {
  const [useDropin, setUseDropin] = useState(false)
  const [saveToWallet, setSaveToWallet] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [authorizing, setAuthorizing] = useState(false)
  const [authorizeError, setAuthorizeError] = useState<string | null>(null)
  // Set once the session has been swapped for a fresh one because its client
  // token was refused, so a token that keeps failing can't loop.
  const sessionRenewedRef = useRef(false)

  async function createSession(
    amount: number | null | undefined,
    vaulting: boolean,
  ) {
    return client.payment_sessions.create({
      amount_cents: amount ?? undefined,
      vaulting,
      payment_setting: client.payment_settings.relationship(setting.id),
      order: client.orders.relationship(orderId),
    })
  }

  async function handleConfirm() {
    if (amountCents == null) return
    setConfirming(true)
    setConfirmError(null)
    try {
      onSessionChange(
        await createSession(
          amountCents,
          !!customerId && (saveToWallet || mustSaveCard),
        ),
      )
    } catch (e) {
      setConfirmError(errorMessage(e, "Failed to confirm payment."))
    } finally {
      setConfirming(false)
    }
  }

  /**
   * Called by the card widget with a 3DS-verified nonce. On a decline the
   * session stays open and the shopper can retry with another card: a declined
   * authorization does not invalidate the session, and the next authorization
   * simply replaces it. The decline reason is not shown because the
   * transaction's response_data is withheld from storefront tokens, only the
   * status is readable. Errors are rethrown for the widget to display.
   *
   * On a vaulting session this authorization is also what stores the card, so
   * a declined one stores nothing.
   */
  async function handleAuthorize(nonce: string) {
    if (!session) return
    setAuthorizing(true)
    setAuthorizeError(null)
    try {
      await client.payment_sessions.update({
        id: session.id,
        client_data: { payment_method_id: nonce },
      })
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
        throw new Error("The card was declined. Try another card.")
      }
      // Only now: the nonce is just a tokenized card, and Braintree accepts or
      // declines it inside the authorization CL relays, so this is the first
      // point where a gift card can be debited safely.
      try {
        await authorizeGiftCards()
      } catch {
        /* best-effort; placement will surface any real problem */
      }
      onAuthorized()
    } finally {
      setAuthorizing(false)
    }
  }

  /** The stored client token was refused (it can expire before the session
   * does), and CL never regenerates it, so swap the session for a new one of
   * the same amount and the same `vaulting`. Only once: a second refusal is a
   * real error. */
  async function renewSession() {
    if (!session || sessionRenewedRef.current) {
      setAuthorizeError("Could not load the card form. Please try again.")
      return
    }
    sessionRenewedRef.current = true
    try {
      await client.payment_sessions.delete(session.id).catch(() => {})
      onSessionChange(
        await createSession(session.amount_cents, !!session.vaulting),
      )
    } catch (e) {
      onSessionChange(null)
      setAuthorizeError(errorMessage(e, "Could not load the card form."))
    }
  }

  if (!session) {
    return (
      <div className="mt-2 flex flex-col gap-2">
        {customerId &&
          (mustSaveCard ? (
            <p className="text-xs text-gray-500">
              This card will be saved — the subscription needs it to charge the
              orders after this one.
            </p>
          ) : (
            <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-500">
              <input
                type="checkbox"
                checked={saveToWallet}
                onChange={(e) => setSaveToWallet(e.target.checked)}
                disabled={confirming}
                className="accent-gray-900"
              />
              Save card for future use
            </label>
          ))}
        <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-500">
          <input
            type="checkbox"
            checked={useDropin}
            onChange={(e) => setUseDropin(e.target.checked)}
            className="accent-gray-900"
          />
          Drop-in UI — instead of Hosted Fields
        </label>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={amountCents == null || confirming}
          className="cursor-pointer self-start rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {confirming ? "Confirming…" : "Confirm"}
        </button>
        {confirmError && <p className="text-xs text-red-500">{confirmError}</p>}
      </div>
    )
  }

  const Step = useDropin ? BraintreeDropinStep : BraintreeHostedFieldsStep
  return (
    <div className="mt-3">
      <Step
        pendingSession={session}
        amountCents={session.amount_cents ?? 0}
        email={customerEmail}
        billingAddress={billingAddress}
        authorizing={authorizing}
        authorizeError={authorizeError}
        onAuthorize={handleAuthorize}
        onError={setAuthorizeError}
        onInitFailed={renewSession}
        onReset={onCancel}
      />
    </div>
  )
}
