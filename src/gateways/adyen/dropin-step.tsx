import type { PaymentSession } from "@commercelayer/sdk";
import { AdyenPaymentForm } from "./dropin-form";

/**
 * Adyen Drop-in step — shown after Confirm for an Adyen session. Renders
 * the Adyen Drop-in (which reports success via onAuthorized) and a Cancel button.
 * Reads Adyen's `id` / `sessionData` from the session's response_data, where CL
 * stores them under Adyen's own field names.
 */
export function AdyenDropinStep({
	pendingSession,
	clientKey,
	authorizing,
	authorizeError,
	onAuthorized,
	onError,
	onReset,
}: {
	pendingSession: PaymentSession;
	clientKey: string | null;
	authorizing: boolean;
	authorizeError: string | null;
	onAuthorized: () => void;
	onError: (message: string) => void;
	onReset: () => void;
}) {
	const sessionId =
		pendingSession.response_data != null &&
		typeof pendingSession.response_data.id === "string"
			? pendingSession.response_data.id
			: null;
	const sessionData =
		pendingSession.response_data != null &&
		typeof pendingSession.response_data.sessionData === "string"
			? pendingSession.response_data.sessionData
			: null;

	return (
		<div className="flex flex-col gap-3">
			{sessionId && sessionData && clientKey && (
				<AdyenPaymentForm
					sessionId={sessionId}
					sessionData={sessionData}
					clientKey={clientKey}
					onAuthorized={onAuthorized}
					onError={onError}
				/>
			)}
			{authorizeError && (
				<p className="text-xs text-red-500">{authorizeError}</p>
			)}
			<div className="flex gap-2">
				<button
					type="button"
					onClick={onReset}
					disabled={authorizing}
					className="cursor-pointer rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-40"
				>
					Cancel
				</button>
			</div>
		</div>
	);
}
