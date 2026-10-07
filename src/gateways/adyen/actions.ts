"use server";

import { getIntegrationClient } from "@/lib/client";
import type { PaymentClient } from "@/lib/payments";

/**
 * Server-side orchestration for the Adyen advanced-flow card (checkout save path).
 *
 * Why server-side: a payment_authorization's response_data carries the raw gateway
 * payload (recurring token, hmac, card metadata, …) and CL does not serve it to
 * sales-channel/customer tokens at all, so the browser cannot read the reusable
 * reference. These actions run with the integration token, which can.
 * (CL used to answer 401 on a non-`pending` authorization; since 2026-07-31 it
 * answers 200 with `response_data` withheld and projects the 3DS action onto
 * `next_action_type` / `next_action_data`, which client tokens *can* read.)
 */

const SLEEP = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function pollAuth(client: PaymentClient, authId: string) {
	let auth = await client.payment_authorizations.retrieve(authId);
	for (let i = 0; i < 30 && auth.status === "pending"; i++) {
		await SLEEP(1000);
		auth = await client.payment_authorizations.retrieve(authId);
	}
	return auth;
}

function isAuthSuccess(auth: {
	status: string;
	response_data?: Record<string, unknown> | null;
}): boolean {
	if (auth.status === "succeeded") return true;
	const resultCode = auth.response_data?.resultCode;
	return (
		typeof resultCode === "string" &&
		["Authorised", "Received"].includes(resultCode)
	);
}

/** Adyen action to hand back to adyen-web, or null when there is none.
 *
 * CL projects it onto `next_action_type` / `next_action_data` — the only form a
 * sales-channel/customer token can read, since `response_data` is withheld from
 * those. These actions run under the integration token and could read
 * `response_data.action` directly, but using the same projection keeps one code
 * path and covers pre-projection authorizations via the fallback. Gate on
 * `next_action_type`: `next_action_data` is `{}`, not null, when empty. */
function adyenNextAction(auth: {
	response_data?: Record<string, unknown> | null;
	next_action_type?: string | null;
	next_action_data?: Record<string, unknown> | null;
}): Record<string, unknown> | null {
	const action = auth.next_action_type
		? auth.next_action_data
		: auth.response_data?.action;
	return action != null &&
		typeof action === "object" &&
		typeof (action as { type?: unknown }).type === "string"
		? (action as Record<string, unknown>)
		: null;
}

/** Did the `_payment_details` PATCH actually move the authorization forward?
 *
 * `updated_at` is the reliable signal: CL's `_payment_details` trigger runs
 * synchronously and, when the Adyen call succeeds, writes `response_data` (and
 * resets the trigger) on the authorization. When the relay to Adyen fails, CL
 * still answers 200, with a byte-identical record. Compare the action too,
 * so an unchanged action is never replayed even if `updated_at` moved for an
 * unrelated reason. */
function didAdvance(
	before: { updated_at?: string | null; response_data?: unknown } | undefined,
	after: { updated_at?: string | null; response_data?: unknown },
): boolean {
	if (!before) return true;
	if (before.updated_at !== after.updated_at) return true;
	return (
		JSON.stringify(before.response_data) !== JSON.stringify(after.response_data)
	);
}

export type AdyenAdvancedResult = {
	sessionId: string;
	status: string;
	resultCode?: string;
	/** 3DS (or other) action to hand back to the adyen-web component, if any. */
	action?: Record<string, unknown> | null;
	error?: string;
};

/** adyen-web needs a `countryCode` in the advanced-flow config (no session to
 * read it from). Derive it from the order address, server-side. */
export async function getOrderCountryCode(
	orderId: string,
): Promise<string | null> {
	const client = await getIntegrationClient();
	const order = await client.orders.retrieve(orderId, {
		include: ["billing_address", "shipping_address"],
	});
	return (
		order.billing_address?.country_code ??
		order.shipping_address?.country_code ??
		null
	);
}

/** Create the session (payload in client_data, `vaulting` when the card is to be
 * stored), relay to Adyen /payments via the authorization, and poll to
 * completion. A stored card turns into a CL payment_wallet on its own, from the
 * webhook that follows. */
export async function authorizeAdyenAdvanced(input: {
	orderId: string;
	settingId: string;
	amountCents: number;
	clientData: Record<string, unknown>;
	storing: boolean;
	customerId: string | null;
}): Promise<AdyenAdvancedResult> {
	const { orderId, settingId, amountCents, clientData, storing, customerId } =
		input;
	const client = await getIntegrationClient();
	try {
		// `vaulting` is the whole store request: CL then sends Adyen
		// `storePaymentMethod: true`, the recurringProcessingModel that fits the
		// order (Subscription on a recurring one, CardOnFile otherwise), and the
		// customer's own `shopper_reference` — the value the RECURRING_CONTRACT
		// webhook uses to find the customer the wallet belongs to. A wallet needs
		// a customer, so a guest never vaults.
		const session = await client.payment_sessions.create({
			amount_cents: amountCents,
			client_data: clientData,
			vaulting: storing && !!customerId,
			payment_setting: client.payment_settings.relationship(settingId),
			order: client.orders.relationship(orderId),
		});

		const created = await client.payment_authorizations.create({
			payment_session: client.payment_sessions.relationship(session.id),
		});
		const auth = await pollAuth(client, created.id);
		const resultCode =
			typeof auth.response_data?.resultCode === "string"
				? (auth.response_data.resultCode as string)
				: undefined;
		const action = adyenNextAction(auth);

		if (auth.status === "requires_action" || action != null) {
			return { sessionId: session.id, status: auth.status, resultCode, action };
		}

		if (!isAuthSuccess(auth)) {
			const reason =
				typeof auth.response_data?.refusalReason === "string"
					? (auth.response_data.refusalReason as string)
					: `Payment ${auth.status}.`;
			return { sessionId: session.id, status: auth.status, error: reason };
		}

		// On success the card is stored on Adyen; CL creates the payment_wallet
		// asynchronously from Adyen's RECURRING_CONTRACT webhook, keyed by
		// shopper_reference. Nothing to do here — it surfaces in the customer's
		// wallets shortly after, and a subscription created from this order is
		// activated when it does. Success is confirmed server-side
		// (isAuthSuccess), so default the resultCode rather than making the client
		// fabricate one it can't verify.
		return {
			sessionId: session.id,
			status: auth.status,
			resultCode: resultCode ?? "Authorised",
		};
	} catch (e) {
		return {
			sessionId: "",
			status: "error",
			error: e instanceof Error ? e.message : "Authorization failed.",
		};
	}
}

/** 3DS follow-up: relay the details to Adyen /payments/details and re-poll.
 *
 * The details are submitted via the authorization's `_payment_details` trigger,
 * which is what CL routes to Adyen `/payments/details`. (The session's
 * `_additional_data` trigger goes to `/paymentMethods` — wrong endpoint.) CL
 * forwards `_payment_details` verbatim, so we pass the FULL adyen-web
 * `state.data` (`{ details, paymentData }`): `paymentData` links the details to
 * the original transaction, without it Adyen returns 422. */
export async function submitAdyenAdvancedDetails(input: {
	sessionId: string;
	/** Full adyen-web `state.data` from onAdditionalDetails: `{ details, paymentData }`. */
	stateData: unknown;
}): Promise<AdyenAdvancedResult> {
	const { sessionId, stateData } = input;
	const client = await getIntegrationClient();
	try {
		const session = await client.payment_sessions.retrieve(sessionId, {
			include: ["payment_authorization"],
		});
		const before = session.payment_authorization;
		const authId = before?.id;
		if (!authId) {
			return {
				sessionId,
				status: "error",
				error: "No authorization to submit 3DS details to.",
			};
		}

		// CL calls Adyen /payments/details synchronously during this PATCH and
		// returns the already-updated authorization. Read the result from THIS return value —
		// not a separate poll (a pre-submit poll returns the stale pre-details state).
		const auth = await client.payment_authorizations._payment_details(
			authId,
			stateData as Record<string, unknown>,
		);

		// When the relay to Adyen /payments/details fails, CL doesn't fail the
		// request: the error is attached to the payment_session, not to the
		// authorization being PATCHed, and the request answers 200 with the
		// authorization COMPLETELY UNCHANGED. Detect that here — otherwise we'd hand
		// the *stale* fingerprint action back to adyen-web, which would POST
		// submitThreeDS2Fingerprint a second time with an already-used token and get
		// a 500 `14_0401` from Adyen.
		if (!didAdvance(before, auth)) {
			return {
				sessionId,
				status: auth.status,
				error:
					"Commerce Layer did not process the 3-D Secure details (the authorization is unchanged). Check the payment_session errors for the Adyen /payments/details error.",
			};
		}

		const resultCode =
			typeof auth.response_data?.resultCode === "string"
				? (auth.response_data.resultCode as string)
				: undefined;
		const action = adyenNextAction(auth);
		// Native 3DS2 is multi-step (fingerprint → challenge): each /payments/details
		// round can return a further action. Relay it so adyen-web renders the next
		// step and fires onAdditionalDetails again, instead of failing here.
		if (auth.status === "requires_action" || action != null) {
			return { sessionId, status: auth.status, resultCode, action };
		}
		if (!isAuthSuccess(auth)) {
			const reason =
				typeof auth.response_data?.refusalReason === "string"
					? (auth.response_data.refusalReason as string)
					: "Authentication failed.";
			return { sessionId, status: auth.status, error: reason };
		}
		// Success is confirmed server-side (isAuthSuccess) — default the resultCode
		// here so the client never has to fabricate an "Authorised" it can't verify.
		return {
			sessionId,
			status: auth.status,
			resultCode: resultCode ?? "Authorised",
		};
	} catch (e) {
		return {
			sessionId,
			status: "error",
			error: e instanceof Error ? e.message : "Authentication failed.",
		};
	}
}
