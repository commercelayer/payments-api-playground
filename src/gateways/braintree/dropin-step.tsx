"use client";

import type { Address, PaymentSession } from "@commercelayer/sdk";
import type { Dropin } from "braintree-web-drop-in";
import { useEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/payments";
import {
	assertLiabilityShift,
	threeDSecureAmount,
	toThreeDSecureAddress,
} from "./three-d-secure";

/**
 * Braintree Drop-in step — the alternative to BraintreeAuthorizationStep,
 * built from the same client token in the session's response_data.
 *
 * The Drop-in bundles card entry and 3-D Secure in one widget:
 * `requestPaymentMethod` tokenizes the card and runs `verifyCard` itself,
 * opening the issuer challenge when one is required. What comes back is the
 * same 3DS-enriched nonce Hosted Fields produce, so from there on the flow is
 * shared: the same liability-shift check, then `onAuthorize`, which stores the
 * nonce on the session and creates the CL authorization.
 *
 * Cards only: no PayPal, Venmo or wallets are configured, so the Drop-in shows
 * nothing else even where the merchant account has them enabled.
 */
export function BraintreeDropinStep({
	pendingSession,
	amountCents,
	email,
	billingAddress,
	authorizing,
	authorizeError,
	onAuthorize,
	onError,
	onInitFailed,
	onReset,
}: {
	pendingSession: PaymentSession;
	amountCents: number;
	email: string | null | undefined;
	billingAddress: Address | null | undefined;
	authorizing: boolean;
	authorizeError: string | null;
	onAuthorize: (nonce: string) => Promise<void>;
	onError: (message: string) => void;
	/** The client token was refused (e.g. it expired while the session stayed
	 * open), so the Drop-in cannot load for this session. */
	onInitFailed: () => void;
	onReset: () => void;
}) {
	const clientToken =
		pendingSession.response_data != null &&
		typeof pendingSession.response_data.clientToken === "string"
			? pendingSession.response_data.clientToken
			: null;

	const containerRef = useRef<HTMLDivElement>(null);
	const dropinRef = useRef<Dropin | null>(null);
	const [ready, setReady] = useState(false);
	const [verifying, setVerifying] = useState(false);

	// Stable refs so the effect doesn't re-run when callbacks change identity
	const onInitFailedRef = useRef(onInitFailed);
	onInitFailedRef.current = onInitFailed;

	useEffect(() => {
		if (!clientToken || !containerRef.current) return;
		const container = containerRef.current;
		let cancelled = false;
		let dropin: Dropin | null = null;

		(async () => {
			const braintreeDropin = await import("braintree-web-drop-in");
			if (cancelled) return;
			try {
				dropin = await braintreeDropin.create({
					authorization: clientToken,
					container,
					card: { cardholderName: { required: true } },
					threeDSecure: true,
				});
			} catch {
				if (!cancelled) onInitFailedRef.current();
				return;
			}
			if (cancelled) {
				dropin.teardown().catch(() => {});
				return;
			}
			dropinRef.current = dropin;
			setReady(true);
		})();

		return () => {
			cancelled = true;
			dropinRef.current = null;
			setReady(false);
			dropin?.teardown().catch(() => {});
		};
	}, [clientToken]);

	async function handleSubmit() {
		const dropin = dropinRef.current;
		if (!dropin) return;
		setVerifying(true);
		try {
			const payload = await dropin.requestPaymentMethod({
				threeDSecure: {
					amount: threeDSecureAmount(amountCents),
					email: email ?? undefined,
					billingAddress: toThreeDSecureAddress(billingAddress),
				},
			});
			if (payload.type !== "CreditCard") {
				throw new Error("Only cards are supported here.");
			}
			assertLiabilityShift(payload);
			await onAuthorize(payload.nonce);
		} catch (e) {
			// The Drop-in keeps the tokenized card selected, and its nonce is
			// already spent: clear it so a retry enters the card again.
			dropin.clearSelectedPaymentMethod();
			onError(errorMessage(e, "Payment authorization failed."));
		} finally {
			setVerifying(false);
		}
	}

	const busy = verifying || authorizing;

	return (
		<div className="flex flex-col gap-3">
			{clientToken ? (
				<div ref={containerRef} data-testid="braintree-dropin" />
			) : (
				<p className="text-xs text-red-500">
					Braintree did not return a client token for this session.
				</p>
			)}
			{authorizeError && (
				<p className="text-xs text-red-500">{authorizeError}</p>
			)}
			<div className="flex gap-2">
				<button
					type="button"
					onClick={handleSubmit}
					disabled={!ready || busy}
					className="cursor-pointer rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
				>
					{busy ? "Authorizing…" : "Authorize"}
				</button>
				<button
					type="button"
					onClick={onReset}
					disabled={busy}
					className="cursor-pointer rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-40"
				>
					Cancel
				</button>
			</div>
		</div>
	);
}
