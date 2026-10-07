import { createMollieClient } from "@mollie/api-client";
import { rejectUnsignedRequest } from "@/lib/gateway-signature";

export async function POST(request: Request) {
	const rawBody = await request.text();
	const rejection = rejectUnsignedRequest("authorize", rawBody, request);
	if (rejection) return rejection;

	let body: Record<string, unknown>;
	try {
		body = JSON.parse(rawBody);
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	console.log(
		"[gateway/authorize] Received payload:",
		JSON.stringify(body, null, 2),
	);

	const included = body.included as
		| { id: string; type: string; attributes: Record<string, unknown> }[]
		| undefined;

	const sessionResource = included?.find((r) => r.type === "payment_sessions");
	const sessionResponseData = (
		sessionResource?.attributes?.response_data as { data: unknown } | undefined
	)?.data as Record<string, unknown> | undefined;
	const paymentId = sessionResponseData?.id as string | undefined;

	if (!paymentId) {
		console.error(
			"[gateway/authorize] Missing Mollie payment id in session response_data",
		);
		return Response.json(
			{
				error:
					"Missing payment id — check external_includes includes payment_session",
			},
			{ status: 400 },
		);
	}

	const mollieApiKey = process.env.MOLLIE_API_KEY;
	if (!mollieApiKey) {
		return Response.json(
			{ error: "MOLLIE_API_KEY not configured" },
			{ status: 500 },
		);
	}

	try {
		const mollie = createMollieClient({ apiKey: mollieApiKey });
		const payment = await mollie.payments.get(paymentId);

		console.log(
			`[gateway/authorize] Mollie payment ${paymentId} status: ${payment.status}`,
		);

		if (payment.status !== "paid") {
			return Response.json(
				{ error: `Payment not authorized (Mollie status: ${payment.status})` },
				{ status: 402 },
			);
		}

		const transactionToken = `cl-${paymentId}-${Date.now()}`;

		return Response.json({
			success: true,
			data: {
				action_id: paymentId,
				transaction_token: transactionToken,
			},
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error("[gateway/authorize] Mollie error:", message);
		return Response.json({ error: message }, { status: 500 });
	}
}
