"use client";

import { useState } from "react";
import { type PaymentClient, pollAuthorization } from "@/lib/payments";
import { AdyenActionStep } from "./action-step";
import {
	type AdyenPendingAction,
	adyenAction,
	isAdyenAuthSuccess,
} from "./authorization";

/**
 * Runs the 3-D Secure step Adyen asked for on an authorization, in the page,
 * and relays the result to CL. Used by the saved-card payment and by the return
 * from a 3-D Secure redirect, whenever the authorization comes back
 * `requires_action`.
 *
 * The result goes to the authorization's `_payment_details` trigger, which CL
 * forwards verbatim to Adyen /payments/details. The session's
 * `_additional_data` trigger is the wrong one here: it goes to /paymentMethods.
 */
export function AdyenThreeDSAction({
	client,
	orderId,
	pending,
	onAuthorized,
	onError,
}: {
	client: PaymentClient;
	orderId: string;
	pending: AdyenPendingAction;
	onAuthorized: () => void;
	onError: (message: string) => void;
}) {
	const [current, setCurrent] = useState(pending);

	async function handleDetails(stateData: unknown) {
		try {
			const session = await client.payment_sessions.retrieve(
				current.sessionId,
				{ include: ["payment_authorization"] },
			);
			const before = session.payment_authorization;
			const authId = before?.id;
			if (!authId)
				throw new Error("No authorization to submit 3DS details to.");
			// Pass the full state.data ({ details, paymentData }): paymentData is what
			// links it to the original transaction.
			await client.payment_authorizations._payment_details(
				authId,
				stateData as Record<string, unknown>,
			);
			const auth = await pollAuthorization(client, authId);
			// When relaying to /payments/details fails, CL still answers 200, with the
			// authorization untouched. Treat "unchanged" as a failure: replaying the
			// same threeDS2 action makes adyen-web re-submit an already-used
			// fingerprint token, which Adyen answers 500 `14_0401`.
			// Compare the next_action projection, not `response_data`: the latter is
			// withheld from customer tokens, so in the browser both sides are undefined
			// and the comparison is vacuous.
			if (
				before.updated_at === auth.updated_at &&
				JSON.stringify(adyenAction(before)) ===
					JSON.stringify(adyenAction(auth))
			) {
				throw new Error(
					"Commerce Layer did not process the 3-D Secure details (the authorization is unchanged).",
				);
			}
			// Native 3DS2 can be multi-step (fingerprint → challenge): if another
			// action comes back, render it for the next round rather than failing.
			const action = adyenAction(auth);
			if (action) {
				setCurrent({ ...current, action });
				return;
			}
			if (auth.status === "requires_action") {
				throw new Error(
					"Adyen requires additional authentication but returned no action to render.",
				);
			}
			if (!isAdyenAuthSuccess(auth)) {
				const refusal = auth.response_data?.refusalReason;
				throw new Error(
					typeof refusal === "string" ? refusal : "Authentication failed.",
				);
			}
			onAuthorized();
		} catch (e) {
			onError(e instanceof Error ? e.message : "Payment failed.");
		}
	}

	return (
		<div className="px-6 py-5">
			<p className="mb-3 text-sm font-medium text-gray-700">
				Complete authentication
			</p>
			<AdyenActionStep
				action={current.action}
				clientKey={current.clientKey}
				orderId={orderId}
				onDetails={handleDetails}
				onError={onError}
			/>
		</div>
	);
}
