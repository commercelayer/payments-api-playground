import type { PaymentSession, PaymentSettingAdyen } from "@commercelayer/sdk";
import { type PaymentClient, pollAuthorization } from "@/lib/payments";
import {
	type AdyenPendingAction,
	adyenAction,
	isAdyenAuthSuccess,
} from "./authorization";
import { completeAdyenSessionRedirect } from "./session-return";

/** Query parameters Adyen appends to the `returnUrl` after a redirect. */
export const ADYEN_RETURN_PARAMS = ["redirectResult", "sessionId"];

/**
 * The redirect result of an Adyen return, or null when the page was not
 * reached from one.
 *
 * A `redirect` next_action (3DS1, or 3DS2 when the card is not enrolled for
 * native) takes the shopper to the issuer's ACS and back to the /payments
 * `returnUrl`, which is the order page, with `redirectResult` in the query
 * string. That param IS the authentication result: it is relayed to Adyen
 * /payments/details as `{ details: { redirectResult } }`, and needs no
 * `paymentData`.
 *
 * Adyen adds its own `sessionId` only when the redirect started from the
 * Drop-in (sessions flow). The advanced flow returns `redirectResult` alone.
 * The two resume in completely different ways, so this is what tells them
 * apart.
 */
export function adyenReturn(
	searchParams: URLSearchParams,
): { redirectResult: string; adyenSessionId: string | null } | null {
	const redirectResult = searchParams.get("redirectResult");
	if (redirectResult == null) return null;
	return { redirectResult, adyenSessionId: searchParams.get("sessionId") };
}

function clientKeyOf(session: PaymentSession): string | null | undefined {
	return (
		session.payment_setting as PaymentSettingAdyen & {
			public_key?: string | null;
		}
	).public_key;
}

/**
 * Finishes an Adyen payment after a redirect. The redirect destroyed all
 * in-memory state, so everything is recovered from the URL: the order id is
 * in the path (the /payments `returnUrl` is the order page) and the order's
 * sessions arrive with their `payment_authorization` included, so there is
 * nothing to stash before leaving. Covers both Adyen paths that redirect,
 * saved-card reuse and the advanced-flow new card, because it keys off the
 * order's sessions, not off state the redirect wiped.
 *
 * Returns a further 3-D Secure action when Adyen asks for one, for the caller
 * to render. Otherwise the session is authorized when this returns, and the
 * caller places the order. Throws when the payment can't be completed.
 */
export async function resumeAdyenRedirect({
	client,
	paymentSessions,
	redirectResult,
	adyenSessionId,
	authorizeGiftCards,
}: {
	client: PaymentClient;
	paymentSessions: PaymentSession[];
	redirectResult: string;
	adyenSessionId: string | null;
	authorizeGiftCards: () => Promise<void>;
}): Promise<AdyenPendingAction | null> {
	const adyenSessions = paymentSessions.filter(
		(s) => s.payment_setting?.type === "payment_setting_adyens",
	);

	if (adyenSessionId != null) {
		await resumeDropinPayment({
			client,
			adyenSessions,
			adyenSessionId,
			redirectResult,
			authorizeGiftCards,
		});
		return null;
	}

	const session = adyenSessions.find(
		(s) => s.payment_authorization?.status === "requires_action",
	);
	const authId = session?.payment_authorization?.id;

	if (!session || !authId) {
		// Nothing left to authenticate. That is not necessarily a failure: the
		// authorization may already have settled — a webhook can beat the shopper
		// back, and a second return lands here too. Finish the order instead of
		// blaming the shopper for a payment that worked.
		const settled = adyenSessions.find(
			(s) =>
				s.payment_authorization != null &&
				isAdyenAuthSuccess(s.payment_authorization),
		);
		if (!settled) {
			throw new Error(
				"Returned from 3-D Secure but no authorization is awaiting authentication. Please refresh and try again.",
			);
		}
		await authorizeGiftCards();
		return null;
	}

	// CL forwards `_payment_details` verbatim to Adyen /payments/details.
	await client.payment_authorizations._payment_details(authId, {
		details: { redirectResult },
	});
	// Poll through `requires_action` as well: that is the status the
	// authorization is in right now, and reading it back before it clears
	// returns the action we have just satisfied. Rendering that stale action
	// sends the shopper to the challenge a second time, and the return from
	// *that* finds nothing awaiting authentication. A genuine second challenge
	// still surfaces, just after this shorter wait.
	const auth = await pollAuthorization(client, authId, {
		transientStatuses: ["pending", "requires_action"],
		maxAttempts: 10,
	});

	// A further action (e.g. a second challenge) is unusual after a redirect but
	// costs nothing to support. Only when the authorization still says it is
	// waiting for one: `next_action_data` keeps the action we have just
	// satisfied even after the status moves on, so reading it unconditionally
	// re-renders the *original* challenge and sends the shopper back to Adyen,
	// same `pspReference` and all.
	if (auth.status === "requires_action") {
		const action = adyenAction(auth);
		if (!action) {
			throw new Error(
				"Adyen still requires authentication but returned no action to render.",
			);
		}
		const clientKey = clientKeyOf(session);
		if (!clientKey) throw new Error("Missing Adyen client key.");
		return { action, sessionId: session.id, clientKey };
	}
	if (!isAdyenAuthSuccess(auth)) {
		throw new Error(`Authentication failed (${auth.status}).`);
	}

	await authorizeGiftCards();
	return null;
}

/**
 * Drop-in half of the Adyen redirect return. The payment belongs to the Adyen
 * session, not to a CL authorization: in the sessions flow the app only
 * creates the authorization once the Drop-in reports success, so there is none
 * yet to relay the redirect result to. Adyen is asked to finish the session
 * first, and only a payment it accepts gets its gift cards authorized and its
 * CL authorization created — the same order the Drop-in's own success callback
 * follows.
 *
 * Also safe on a second return (a reload with the params still in the URL): an
 * authorization that already exists means the payment was finished.
 */
async function resumeDropinPayment({
	client,
	adyenSessions,
	adyenSessionId,
	redirectResult,
	authorizeGiftCards,
}: {
	client: PaymentClient;
	adyenSessions: PaymentSession[];
	adyenSessionId: string;
	redirectResult: string;
	authorizeGiftCards: () => Promise<void>;
}) {
	const session = adyenSessions.find(
		(s) => s.response_data?.id === adyenSessionId,
	);
	if (!session) {
		throw new Error(
			"Returned from 3-D Secure but the payment session could not be found. Please refresh and try again.",
		);
	}
	if (session.payment_authorization != null) return;

	const clientKey = clientKeyOf(session);
	const sessionData = session.response_data?.sessionData;
	if (!clientKey || typeof sessionData !== "string") {
		throw new Error("Missing Adyen session details to finish 3-D Secure.");
	}

	const resultCode = await completeAdyenSessionRedirect({
		clientKey,
		sessionId: adyenSessionId,
		sessionData,
		redirectResult,
	});
	if (
		resultCode !== "Authorised" &&
		resultCode !== "Pending" &&
		resultCode !== "Received"
	) {
		throw new Error(`Payment ${resultCode?.toLowerCase() ?? "failed"}.`);
	}

	await authorizeGiftCards();
	await client.payment_authorizations.create({
		payment_session: client.payment_sessions.relationship(session.id),
	});
}
