import type {
	Address,
	PaymentSession,
	PaymentSetting,
} from "@commercelayer/sdk";
import type { PaymentClient } from "@/lib/payments";

/**
 * What the checkout hands to a gateway once the shopper has picked one of its
 * payment settings. From there the gateway owns the whole card flow: creating
 * the payment_session, collecting the card, and getting the session
 * authorized. The checkout keeps what every gateway shares: gift cards, the
 * remaining balance and placing the order.
 */
export type GatewayPaymentProps = {
	client: PaymentClient;
	orderId: string;
	setting: PaymentSetting;
	/** Amount the shopper chose to pay with this method, or null while the
	 * amount field holds something unusable. */
	amountCents: number | null;
	currencyCode: string;
	/** Sent with 3-D Secure where the gateway accepts them: the more the issuer
	 * knows, the more often it lets the shopper through without a challenge. */
	customerEmail?: string | null;
	billingAddress?: Address | null;
	/** Logged-in customer, or null for a guest. Storing a card needs one. */
	customerId: string | null;
	/** The order will mint a subscription, so the card must be stored. */
	mustSaveCard: boolean;
	/** The payment_session in progress for this method. Held by the checkout,
	 * which deletes it when the shopper changes method or the balance moves. */
	session: PaymentSession | null;
	onSessionChange: (session: PaymentSession | null) => void;
	/** The gateway has mounted a card form that has no payment_session yet
	 * (Adyen's advanced flow creates it when the card is submitted). The
	 * checkout locks the amount meanwhile, since the form was built for it. */
	onFormOpenChange?: (open: boolean) => void;
	/** Authorizes the gift cards applied to the order. Call it only once the
	 * gateway has accepted the method's payment, so a declined card leaves no
	 * gift card debited: when the gateway decides in the browser (Stripe's
	 * `confirmPayment`, the Adyen Drop-in), that is before the CL authorization
	 * is created; when CL relays the authorization to the gateway, after it has
	 * succeeded. */
	authorizeGiftCards: () => Promise<void>;
	/** The session is authorized: the checkout refreshes the order and places
	 * it once nothing is left to pay. */
	onAuthorized: () => void;
	onCancel: () => void;
};
