import {
	CommerceLayerStatic,
	type PaymentAuthorization,
	type PaymentSession,
} from "@commercelayer/sdk";
import type { createClient } from "./create-client";

export type PaymentClient = ReturnType<typeof createClient>;

/** A readable message for a failed call. The SDK's ApiError carries an empty
 * `message` and puts CL's explanation in `errors[].detail`, so reading
 * `message` alone shows the shopper nothing at all. */
export function errorMessage(e: unknown, fallback: string): string {
	if (CommerceLayerStatic.isApiError(e)) {
		const detail = e.errors?.[0]?.detail;
		if (typeof detail === "string" && detail) return detail;
	}
	return e instanceof Error && e.message ? e.message : fallback;
}

/**
 * Poll a payment_authorization until it leaves `pending`.
 *
 * For Adyen's advanced flow, `payment_authorizations.create` relays Adyen
 * `/payments` **asynchronously**: the authorization comes back `pending` and CL
 * populates its `status` + `response_data` (resultCode/action) once Adyen
 * responds. We poll every `intervalMs` until a terminal state (`succeeded`,
 * `declined`, `failed`) or `requires_action` (3DS), bailing after `maxAttempts`.
 */
export async function pollAuthorization(
	client: PaymentClient,
	authId: string,
	{
		intervalMs = 1000,
		maxAttempts = 30,
		transientStatuses = ["pending"],
	}: {
		intervalMs?: number;
		maxAttempts?: number;
		/** Statuses to keep polling through. The default covers the create case,
		 * where CL relays to Adyen asynchronously. After submitting a 3-D Secure
		 * result the caller should also poll through `requires_action`: that is the
		 * status the authorization is already in, and it takes a moment to clear —
		 * returning early hands back the *old* action, which re-renders and
		 * redirects the shopper to the challenge a second time. */
		transientStatuses?: string[];
	} = {},
): Promise<PaymentAuthorization> {
	let auth = await client.payment_authorizations.retrieve(authId);
	for (
		let i = 0;
		i < maxAttempts && transientStatuses.includes(auth.status);
		i++
	) {
		await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
		auth = await client.payment_authorizations.retrieve(authId);
	}
	return auth;
}

/**
 * Authorizes any applied gift card sessions that aren't authorized yet.
 *
 * Gift cards are applied before a payment method is chosen, but authorized
 * only once the method's gateway has accepted the payment. A gift card
 * authorization captures in the same step, while a card authorization is a
 * hold that a void can release: authorizing the gift cards first would leave
 * them debited whenever the card is then declined.
 */
export async function authorizeAppliedGiftCards(
	client: PaymentClient,
	appliedGiftCards: PaymentSession[],
) {
	for (const session of appliedGiftCards) {
		if (session.payment_authorization != null) continue;
		await client.payment_authorizations.create({
			payment_session: client.payment_sessions.relationship(session.id),
		});
	}
}

/**
 * pollAndPlace — transitions the order through the CL lifecycle.
 *
 * The CL API requires two separate steps:
 *  - `_placeable: true`  verifies that all sessions are in the right state.
 *    This can transiently fail while Stripe webhooks are being processed,
 *    so we retry up to 5 times with a 1 s delay.
 *  - `_place: true`      finalises the order once placeable = true.
 *
 * `createSubscriptions` rides along on that same patch rather than following it:
 * `_create_subscriptions` is accepted *upon* placing, so one request both places
 * the order and turns its recurring line items into order_subscriptions. Doing it
 * in two requests leaves a window where the order is placed but its subscription
 * does not exist yet, and a failure in between needs a retry to close.
 */
export async function pollAndPlace(
	client: PaymentClient,
	orderId: string,
	{ createSubscriptions = false }: { createSubscriptions?: boolean } = {},
) {
	const MAX_ATTEMPTS = 5;
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		try {
			const result = await client.orders._placeable(orderId);
			if (result.placeable === true) break;
			if (attempt >= MAX_ATTEMPTS)
				throw new Error(
					`Order is not placeable after ${MAX_ATTEMPTS} attempts.`,
				);
		} catch (e) {
			if (attempt >= MAX_ATTEMPTS)
				throw e instanceof Error
					? e
					: new Error(`Order is not placeable after ${MAX_ATTEMPTS} attempts.`);
		}
		await new Promise<void>((resolve) => setTimeout(resolve, 1000));
	}
	return client.orders.update({
		id: orderId,
		_place: true,
		...(createSubscriptions ? { _create_subscriptions: true } : {}),
	});
}

// NOTE: no payment_wallet is created client-side, for any gateway. A session
// created with `vaulting: true` asks CL to store the card during the charge, and
// CL links the wallet itself: from the confirmed PaymentIntent on Stripe, from
// Adyen's `RECURRING_CONTRACT` webhook (keyed by `customer.shopper_reference`)
// on Adyen. Writing it from here was never reliable anyway: a succeeded
// authorization isn't readable by the storefront token (401), and the Stripe
// token only showed up on the session after a webhook, so the old helpers had to
// sleep and hope.

/**
 * refundCapturedGiftCards — rollback helper called on placement failure.
 *
 * Gift card sessions are authorized at place-order time (see handlePlaceOrder).
 * If placement fails after some gift cards have already been captured we need
 * to refund them so the customer's gift card balance is restored.  We wait
 * 2 s to allow any in-flight capture webhooks to settle before querying.
 */
export async function refundCapturedGiftCards(
	client: PaymentClient,
	orderId: string,
) {
	await new Promise<void>((resolve) => setTimeout(resolve, 2000));
	const freshOrder = await client.orders.retrieve(orderId, {
		include: [
			"payment_sessions.payment_setting",
			"payment_sessions.payment_captures",
		],
	});
	const giftCardSessions = (freshOrder.payment_sessions ?? []).filter(
		(s) =>
			s.payment_setting?.type === "payment_setting_gift_cards" &&
			s.status === "paid",
	);
	for (const session of giftCardSessions) {
		const capture = (session.payment_captures ?? [])[0] ?? null;
		if (capture == null) continue;
		try {
			await client.payment_refunds.create({
				payment_session: client.payment_sessions.relationship(session.id),
				payment_capture: client.payment_captures.relationship(capture.id),
			});
		} catch {
			// best-effort
		}
	}
}

/**
 * refundGiftCardSession — gives a debited gift card its balance back.
 *
 * A gift card is charged the moment its session is authorized: the API captures
 * in the same step, so there is no authorized-but-uncharged state to void and a
 * refund against the capture is the only way back. A storefront token is
 * allowed to do this while the order is still pending.
 *
 * Deleting such a session instead would drop the records while leaving the
 * customer's balance spent, which is why removal has to come through here.
 */
export async function refundGiftCardSession(
	client: PaymentClient,
	sessionId: string,
) {
	const session = await client.payment_sessions.retrieve(sessionId, {
		include: ["payment_captures"],
	});
	// `payment_refunds` is not readable by a storefront token — it comes back
	// empty rather than missing — so an already refunded session is recognised
	// by its status instead.
	if (session.status === "refunded") return;

	const capture = (session.payment_captures ?? [])[0] ?? null;
	if (capture == null) {
		throw new Error("This gift card has no capture to refund.");
	}
	await client.payment_refunds.create({
		payment_session: client.payment_sessions.relationship(sessionId),
		payment_capture: client.payment_captures.relationship(capture.id),
	});
}

/**
 * cascadeDeleteSession — deletes a payment_session and all its child
 * transactions in reverse dependency order:
 *   payment_refunds → payment_captures → payment_authorization → payment_session
 * This is required because CL rejects deleting a parent resource while its
 * child transactions still exist.
 */
export async function cascadeDeleteSession(
	client: PaymentClient,
	sessionId: string,
) {
	const freshSession = await client.payment_sessions.retrieve(sessionId, {
		include: ["payment_authorization", "payment_captures", "payment_refunds"],
	});
	const auth = freshSession.payment_authorization ?? null;
	const captures = freshSession.payment_captures ?? [];
	const refunds = freshSession.payment_refunds ?? [];

	for (const refund of refunds) {
		await client.payment_refunds.delete(refund.id);
	}
	for (const capture of captures) {
		await client.payment_captures.delete(capture.id);
	}
	if (auth != null) {
		await client.payment_authorizations.delete(auth.id);
	}
	await client.payment_sessions.delete(sessionId);
}
