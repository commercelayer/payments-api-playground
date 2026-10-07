"use client";

import type { Address, PaymentSession } from "@commercelayer/sdk";
import type { Client } from "braintree-web/client";
import type { HostedFields } from "braintree-web/hosted-fields";
import type { ThreeDSecure } from "braintree-web/three-d-secure";
import { useEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/payments";
import {
	assertLiabilityShift,
	threeDSecureAmount,
	toThreeDSecureAddress,
} from "./three-d-secure";

const FIELD_CLASS =
	"h-10 rounded-lg border border-gray-200 bg-white px-3 transition focus-within:border-gray-400";

/**
 * Braintree Hosted Fields — shown after Confirm for a Braintree session.
 * Mounts Hosted Fields with the client token CL stored in the session's
 * response_data, then on submit:
 *
 *   1. tokenizes the card into a nonce,
 *   2. runs 3-D Secure `verifyCard`, which swaps it for a 3DS-enriched nonce and
 *      opens the issuer challenge in a modal when one is required,
 *   3. refuses the payment when authentication was possible but did not shift
 *      liability (failed or abandoned challenge),
 *   4. hands the nonce to `onAuthorize`, which stores it on the session and
 *      creates the CL authorization.
 *
 * Nonces are single-use, so a retry after a decline goes through the whole
 * sequence again against the same session.
 */
export function BraintreeHostedFieldsStep({
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
	 * open), so the form cannot load for this session. */
	onInitFailed: () => void;
	onReset: () => void;
}) {
	const clientToken =
		pendingSession.response_data != null &&
		typeof pendingSession.response_data.clientToken === "string"
			? pendingSession.response_data.clientToken
			: null;

	const nameRef = useRef<HTMLDivElement>(null);
	const numberRef = useRef<HTMLDivElement>(null);
	const expiryRef = useRef<HTMLDivElement>(null);
	const cvvRef = useRef<HTMLDivElement>(null);
	const hostedFieldsRef = useRef<HostedFields | null>(null);
	const threeDSecureRef = useRef<ThreeDSecure | null>(null);
	const [ready, setReady] = useState(false);
	const [verifying, setVerifying] = useState(false);

	// Stable refs so the effect doesn't re-run when callbacks change identity
	const onErrorRef = useRef(onError);
	const onInitFailedRef = useRef(onInitFailed);
	onErrorRef.current = onError;
	onInitFailedRef.current = onInitFailed;

	useEffect(() => {
		if (!clientToken) return;
		let cancelled = false;
		let hostedFields: HostedFields | null = null;
		let threeDSecure: ThreeDSecure | null = null;

		(async () => {
			const [braintreeClient, braintreeHostedFields, braintreeThreeDSecure] =
				await Promise.all([
					import("braintree-web/client"),
					import("braintree-web/hosted-fields"),
					import("braintree-web/three-d-secure"),
				]);
			if (cancelled) return;

			let client: Client;
			try {
				client = await braintreeClient.create({ authorization: clientToken });
			} catch {
				if (!cancelled) onInitFailedRef.current();
				return;
			}
			if (
				cancelled ||
				!nameRef.current ||
				!numberRef.current ||
				!expiryRef.current ||
				!cvvRef.current
			)
				return;

			try {
				[hostedFields, threeDSecure] = await Promise.all([
					braintreeHostedFields.create({
						client,
						styles: {
							input: { "font-size": "14px", color: "#111827" },
							"::placeholder": { color: "#9ca3af" },
							".invalid": { color: "#ef4444" },
						},
						fields: {
							cardholderName: {
								container: nameRef.current,
								placeholder: "Name on card",
							},
							number: {
								container: numberRef.current,
								placeholder: "4111 1111 1111 1111",
							},
							expirationDate: {
								container: expiryRef.current,
								placeholder: "MM/YY",
							},
							cvv: { container: cvvRef.current, placeholder: "CVV" },
						},
					}),
					braintreeThreeDSecure.create({ client, version: 2 }),
				]);
			} catch (e) {
				if (!cancelled)
					onErrorRef.current(
						e instanceof Error ? e.message : "Could not load the card form.",
					);
				return;
			}
			if (cancelled) {
				hostedFields.teardown().catch(() => {});
				threeDSecure.teardown().catch(() => {});
				return;
			}
			hostedFieldsRef.current = hostedFields;
			threeDSecureRef.current = threeDSecure;
			setReady(true);
		})();

		return () => {
			cancelled = true;
			hostedFieldsRef.current = null;
			threeDSecureRef.current = null;
			setReady(false);
			hostedFields?.teardown().catch(() => {});
			threeDSecure?.teardown().catch(() => {});
		};
	}, [clientToken]);

	async function handleSubmit() {
		const hostedFields = hostedFieldsRef.current;
		const threeDSecure = threeDSecureRef.current;
		if (!hostedFields || !threeDSecure) return;
		setVerifying(true);
		try {
			const card = await hostedFields.tokenize();
			const verified = await threeDSecure.verifyCard({
				nonce: card.nonce,
				bin: card.details.bin,
				amount: threeDSecureAmount(amountCents),
				email: email ?? undefined,
				billingAddress: toThreeDSecureAddress(billingAddress),
				collectDeviceData: true,
				onLookupComplete: (_data, next) => next(),
			});
			assertLiabilityShift(verified.threeDSecureInfo);
			await onAuthorize(verified.nonce);
		} catch (e) {
			onErrorRef.current(errorMessage(e, "Payment authorization failed."));
		} finally {
			setVerifying(false);
		}
	}

	const busy = verifying || authorizing;

	return (
		<div className="flex flex-col gap-3">
			{clientToken ? (
				<div className="flex flex-col gap-2" data-testid="braintree-card-form">
					<div ref={nameRef} className={FIELD_CLASS} />
					<div ref={numberRef} className={FIELD_CLASS} />
					<div className="flex gap-2">
						<div ref={expiryRef} className={`${FIELD_CLASS} flex-1`} />
						<div ref={cvvRef} className={`${FIELD_CLASS} flex-1`} />
					</div>
				</div>
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
