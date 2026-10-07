import { createMollieClient } from "@mollie/api-client";
import { signPayload } from "@/lib/gateway-signature";

// Mollie payment status → the `status` of a Commerce Layer external payment
// event (requires_action | processing | succeeded | declined | failed |
// canceled | expired). Statuses not listed here (e.g. "open", "pending") are
// ignored.
const MOLLIE_STATUS_TO_CL: Record<string, string> = {
	paid: "succeeded",
	failed: "failed",
	canceled: "canceled",
	expired: "expired",
};

export async function POST(request: Request) {
	const body = await request.formData();
	const paymentId = body.get("id") as string | undefined;

	if (!paymentId) {
		console.warn("[gateway/mollie-webhook] Missing payment id");
		return new Response("Missing id", { status: 400 });
	}

	console.log(
		`[gateway/mollie-webhook] Received webhook for payment: ${paymentId}`,
	);

	const mollieApiKey = process.env.MOLLIE_API_KEY;
	if (!mollieApiKey) {
		return new Response("MOLLIE_API_KEY not configured", { status: 500 });
	}

	try {
		const mollie = createMollieClient({ apiKey: mollieApiKey });
		const payment = await mollie.payments.get(paymentId);

		console.log(`[gateway/mollie-webhook] Payment status: ${payment.status}`);

		const clStatus = MOLLIE_STATUS_TO_CL[payment.status];
		if (clStatus) {
			const amountCents = Math.round(
				Number.parseFloat(payment.amount.value) * 100,
			);
			await notifyCL({
				sessionToken: payment.id,
				transactionToken: `auth-${payment.id}`,
				amountCents,
				status: clStatus,
			});
		} else {
			console.log(
				`[gateway/mollie-webhook] No CL event for status "${payment.status}" — skipping`,
			);
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error("[gateway/mollie-webhook] Error:", message);
		return new Response("Internal error", { status: 500 });
	}

	// Mollie expects 200 always
	return new Response("OK");
}

/**
 * Notify Commerce Layer of an async payment event by POSTing to the external
 * payment setting's webhook callback (CL_WEBHOOK_ENDPOINT_URL, i.e.
 * /webhook_callbacks/payment_setting_externals/:id).
 *
 * Uses the external payment setting's event contract: an explicit
 * `event_type`, a `status` from the list above, each moving the transaction to
 * the matching state, and a `data.session_token` (the token the gateway
 * returned from session_url) so CL can locate the session. We emit AUTHORIZATION here; capturing and placing the order are
 * left to the payment_setting_external's `auto_capture` / `auto_place` flags.
 */
async function notifyCL({
	sessionToken,
	transactionToken,
	amountCents,
	status,
}: {
	sessionToken: string;
	transactionToken: string;
	amountCents: number;
	status: string;
}) {
	const webhookUrl = process.env.CL_WEBHOOK_ENDPOINT_URL;
	if (!webhookUrl) {
		console.warn(
			"[gateway/mollie-webhook] CL_WEBHOOK_ENDPOINT_URL not set — skipping",
		);
		return;
	}

	const payload = JSON.stringify({
		event_type: "AUTHORIZATION",
		status,
		data: {
			transaction_token: transactionToken,
			session_token: sessionToken,
			amount_cents: amountCents,
		},
	});

	const secret = process.env.GATEWAY_SHARED_SECRET;
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (secret) {
		headers["X-CommerceLayer-Signature"] = signPayload(payload, secret);
	}

	const res = await fetch(webhookUrl, {
		method: "POST",
		headers,
		body: payload,
	});
	if (res.ok) {
		console.log(
			`[gateway/mollie-webhook] CL webhook accepted (${res.status}) — AUTHORIZATION ${status}`,
		);
	} else {
		console.error(
			`[gateway/mollie-webhook] CL webhook rejected (${res.status}): ${await res.text()}`,
		);
	}
}
