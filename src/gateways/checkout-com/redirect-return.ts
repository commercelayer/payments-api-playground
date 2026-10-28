import type { PaymentSession } from "@commercelayer/sdk";
import type { PaymentClient } from "@/lib/payments";
import { authorizeCheckoutComPayment } from "./authorization";

/** Query parameters on the return URL: ours, set on the `success_url` and
 * `failure_url` that `checkout-com-payment.tsx` gives Checkout.com, and the
 * ones Checkout.com appends to it. */
export const CHECKOUT_COM_RETURN_PARAMS = [
	"checkout_com_return",
	"cko-payment-session-id",
	"cko-session-id",
	"cko-payment-id",
];

export type CheckoutComReturn = {
	outcome: "success" | "failure";
	/** The Checkout.com payment id (`pay_…`) Checkout.com appends, if any. */
	paymentId: string | null;
};

/** Whether the page was reached by Checkout.com sending the shopper back, and
 * through which URL: Flow leaves the page for a 3-D Secure challenge (or a
 * redirect payment method) and comes back to `success_url` once the payment
 * is approved, to `failure_url` otherwise. */
export function checkoutComReturn(
	searchParams: URLSearchParams,
): CheckoutComReturn | null {
	const outcome = searchParams.get("checkout_com_return");
	if (outcome !== "success" && outcome !== "failure") return null;
	return { outcome, paymentId: searchParams.get("cko-payment-id") };
}

/**
 * Finishes a Checkout.com payment once the shopper is back. On the inline
 * path Flow's `onPaymentCompleted` does this; after a redirect Flow is gone,
 * so the order page does it here, with the payment id from the return URL.
 * Throws when it can't be completed. The caller then places the order.
 */
export async function resumeCheckoutComRedirect({
	client,
	paymentSessions,
	outcome,
	paymentId,
	authorizeGiftCards,
}: CheckoutComReturn & {
	client: PaymentClient;
	paymentSessions: PaymentSession[];
	authorizeGiftCards: () => Promise<void>;
}): Promise<void> {
	if (outcome === "failure") {
		throw new Error(
			"The payment was not completed. Try again or use another card.",
		);
	}
	const session = paymentSessions.find(
		(s) =>
			s.payment_setting?.type === "payment_setting_checkout_coms" &&
			s.status === "unpaid",
	);
	if (!session || !paymentId) {
		throw new Error(
			"Payment was completed but the session could not be found. Please refresh and try again.",
		);
	}

	await authorizeCheckoutComPayment({
		client,
		session,
		paymentId,
		authorizeGiftCards,
	});
}
