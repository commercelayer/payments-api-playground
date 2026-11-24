import type { PaymentSession } from "@commercelayer/sdk"
import { type PaymentClient, pollAuthorization } from "@/lib/payments"
import { authorizeCheckoutComPayment } from "./authorization"

/** Query parameters on the return URL: ours, set on the `success_url` and
 * `failure_url` that `checkout-com-payment.tsx` gives Checkout.com, and the
 * ones Checkout.com appends to it. */
export const CHECKOUT_COM_RETURN_PARAMS = [
  "checkout_com_return",
  "cko-payment-session-id",
  "cko-session-id",
  "cko-payment-id",
]

/** The `success_url` and `failure_url` Checkout.com requires in the session's
 * `client_data`: CL creates a Checkout.com payment session for every
 * payment_session, and Checkout.com refuses one without them. Both lead back
 * to the order page, marked with `checkout_com_return`. */
export function checkoutComReturnUrls(orderId: string): {
  success_url: string
  failure_url: string
} {
  const orderUrl = `${window.location.origin}/orders/${orderId}`
  return {
    success_url: `${orderUrl}?checkout_com_return=success`,
    failure_url: `${orderUrl}?checkout_com_return=failure`,
  }
}

export type CheckoutComReturn = {
  outcome: "success" | "failure"
  /** The Checkout.com payment id (`pay_…`) Checkout.com appends after a
   * payment Flow submitted. Absent after a payment CL submitted. */
  paymentId: string | null
}

/** Whether the page was reached by Checkout.com sending the shopper back, and
 * through which URL. It comes back to `success_url` once the payment is
 * approved, to `failure_url` otherwise, and appends its own parameters to
 * ours. Two payments leave the page:
 *
 * - one Flow submits, for a 3-D Secure challenge (a failed one always has, so
 *   far) or a redirect payment method. The return carries `cko-payment-id`.
 * - one CL submits, from a saved card: 3-D Secure runs on Checkout.com's own
 *   page. The return carries only `cko-session-id`. */
export function checkoutComReturn(
  searchParams: URLSearchParams,
): CheckoutComReturn | null {
  const outcome = searchParams.get("checkout_com_return")
  if (outcome !== "success" && outcome !== "failure") return null
  return { outcome, paymentId: searchParams.get("cko-payment-id") }
}

/** Authorization statuses of a payment CL submitted and Checkout.com has yet
 * to settle. */
const AWAITING_STATUSES = ["pending", "requires_action"]

/**
 * Finishes a Checkout.com payment once the shopper is back. Throws when it
 * can't be completed. The caller then places the order.
 *
 * - After a payment Flow submitted, Flow is gone, so the order page creates
 *   the authorization that `onPaymentCompleted` would have, with the payment
 *   id from the return URL.
 * - After a payment CL submitted, the authorization already exists, and
 *   Checkout.com settles it through the webhook once 3-D Secure is done. The
 *   page only waits for it. The webhook can beat the shopper back, so an
 *   authorization that has already succeeded counts too.
 */
export async function resumeCheckoutComRedirect({
  client,
  paymentSessions,
  outcome,
  paymentId,
  authorizeGiftCards,
}: CheckoutComReturn & {
  client: PaymentClient
  paymentSessions: PaymentSession[]
  authorizeGiftCards: () => Promise<void>
}): Promise<void> {
  if (outcome === "failure") {
    throw new Error(
      "The payment was not completed. Try again or use another card.",
    )
  }
  const sessions = paymentSessions.filter(
    (s) => s.payment_setting?.type === "payment_setting_checkout_coms",
  )

  if (!paymentId) {
    await settleSubmittedPayment({ client, sessions, authorizeGiftCards })
    return
  }

  const session = sessions.find(
    (s) =>
      s.status === "unpaid" &&
      !AWAITING_STATUSES.includes(s.payment_authorization?.status ?? ""),
  )
  if (!session) {
    throw new Error(
      "Payment was completed but the session could not be found. Please refresh and try again.",
    )
  }
  await authorizeCheckoutComPayment({
    client,
    session,
    paymentId,
    authorizeGiftCards,
  })
}

async function settleSubmittedPayment({
  client,
  sessions,
  authorizeGiftCards,
}: {
  client: PaymentClient
  sessions: PaymentSession[]
  authorizeGiftCards: () => Promise<void>
}): Promise<void> {
  const awaiting = sessions.find((s) =>
    AWAITING_STATUSES.includes(s.payment_authorization?.status ?? ""),
  )?.payment_authorization
  if (awaiting) {
    const auth = await pollAuthorization(client, awaiting.id, {
      transientStatuses: AWAITING_STATUSES,
    })
    if (auth.status === "pending" || auth.status === "requires_action") {
      throw new Error(
        "The payment could not be confirmed. Please refresh in a moment.",
      )
    }
    if (auth.status !== "succeeded") {
      throw new Error("The saved card was declined. Try another card.")
    }
  } else if (
    !sessions.some((s) => s.payment_authorization?.status === "succeeded")
  ) {
    throw new Error(
      "Returned from 3-D Secure but no payment is waiting for it. Please refresh and try again.",
    )
  }
  await authorizeGiftCards()
}
