"use client"

import type { PaymentSettingPaypal } from "@commercelayer/sdk"
import { useState } from "react"
import type { GatewayPaymentProps } from "@/gateways/types"
import { errorMessage, pollAuthorization } from "@/lib/payments"
import { PayPalButtonStep } from "./paypal-button-step"

/**
 * PayPal checkout through a PayPal payment setting, from the shopper's choice
 * to an authorized payment_session.
 *
 * 1. Confirm creates the payment_session. CL creates a PayPal order for it
 *    (Orders v2 API) and keeps the PayPal order id as the session's `token`.
 * 2. PayPal's button (JS SDK v6) opens PayPal's window on that order. The
 *    shopper logs in and approves there. Nothing is written back to the
 *    session: PayPal records the approval on its own order.
 * 3. The CL payment_authorization is created. CL authorizes the approved
 *    PayPal order (or captures it, when the setting has auto capture on). It
 *    is polled until it settles.
 *
 * To store the PayPal account, the session is created with `vaulting: true`
 * and a `return_url` / `cancel_url` in `client_data`, which PayPal requires
 * whenever an account is stored, even though its window here is a popup that
 * never sends the page anywhere. CL asks PayPal to vault the account once the
 * payment succeeds, and links the payment_wallet itself when the authorization
 * runs. As with cards, storing takes the shopper's consent, and a guest has no
 * customer to store it on.
 */
export function PayPalPayment({
  client,
  orderId,
  setting,
  amountCents,
  customerId,
  mustSaveCard,
  session,
  onSessionChange,
  authorizeGiftCards,
  onAuthorized,
  onCancel,
}: GatewayPaymentProps) {
  // The client id PayPal's JS SDK loads with. It is public, so the setting
  // returns it, but the SDK's type doesn't declare it yet.
  const clientId =
    (setting as PaymentSettingPaypal & { client_id?: string | null })
      .client_id ?? null
  const [saveToWallet, setSaveToWallet] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [authorizing, setAuthorizing] = useState(false)
  const [authorizeError, setAuthorizeError] = useState<string | null>(null)

  async function handleConfirm() {
    if (amountCents == null) return
    setConfirming(true)
    setConfirmError(null)
    const vaulting = !!customerId && (saveToWallet || mustSaveCard)
    // PayPal never sends the shopper to these from the popup, so the page
    // itself is fine for both.
    const pageUrl = window.location.origin + window.location.pathname
    try {
      onSessionChange(
        await client.payment_sessions.create({
          amount_cents: amountCents,
          vaulting,
          client_data: vaulting
            ? { return_url: pageUrl, cancel_url: pageUrl }
            : undefined,
          payment_setting: client.payment_settings.relationship(setting.id),
          order: client.orders.relationship(orderId),
        }),
      )
    } catch (e) {
      setConfirmError(errorMessage(e, "Failed to confirm payment."))
    } finally {
      setConfirming(false)
    }
  }

  /**
   * Called once the shopper has approved in PayPal's window. An approved
   * PayPal order can be authorized only once, so after a decline the shopper
   * cancels and confirms again, which creates a new session and a new PayPal
   * order.
   */
  async function handleApprove() {
    if (!session) return
    setAuthorizing(true)
    setAuthorizeError(null)
    try {
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
      onAuthorized()
    } catch (e) {
      setAuthorizeError(errorMessage(e, "Payment authorization failed."))
    } finally {
      setAuthorizing(false)
    }
  }

  if (!clientId) {
    return (
      <p className="mt-2 text-xs text-red-500">
        This payment setting has no PayPal client id.
      </p>
    )
  }

  if (!session) {
    return (
      <div className="mt-2 flex flex-col gap-2">
        {customerId &&
          (mustSaveCard ? (
            <p className="text-xs text-gray-500">
              This PayPal account will be saved — the subscription needs it to
              charge the orders after this one.
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
              Save PayPal account for future use
            </label>
          ))}
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

  if (!session.token) {
    return (
      <p className="mt-2 text-xs text-red-500">
        PayPal did not return an order for this session.
      </p>
    )
  }

  return (
    <div className="mt-3">
      <PayPalButtonStep
        clientId={clientId}
        paypalOrderId={session.token}
        authorizing={authorizing}
        authorizeError={authorizeError}
        onApprove={handleApprove}
        onError={setAuthorizeError}
        onReset={onCancel}
      />
    </div>
  )
}
