import { createMollieClient } from "@mollie/api-client";
import { rejectUnsignedRequest } from "@/lib/gateway-signature";

export async function POST(request: Request) {
	const rawBody = await request.text();
	const rejection = rejectUnsignedRequest("session", rawBody, request);
	if (rejection) return rejection;

	console.log("[gateway/session] Received:", rawBody);
	let body: Record<string, unknown>;
	try {
		body = JSON.parse(rawBody);
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const data = body.data as Record<string, unknown> | undefined;

	// CL sends the order as the top-level resource
	const orderId = data?.id as string | undefined;
	const orderAttrs = data?.attributes as Record<string, unknown> | undefined;
	const orderNumber = String(orderAttrs?.number ?? "");
	// session_amount_cents reflects the partial amount for this session
	const amountCents = (orderAttrs?.session_amount_cents ??
		orderAttrs?.total_amount_with_taxes_cents) as number | undefined;
	const currencyCode = orderAttrs?.currency_code as string | undefined;

	if (!orderId || !amountCents || !currencyCode) {
		console.error("[gateway/session] Missing required fields", {
			orderId,
			amountCents,
			currencyCode,
		});
		return Response.json({ error: "Missing required fields" }, { status: 400 });
	}

	const mollieApiKey = process.env.MOLLIE_API_KEY;
	if (!mollieApiKey) {
		return Response.json(
			{ error: "MOLLIE_API_KEY not configured" },
			{ status: 500 },
		);
	}

	const appOrigin = process.env.APP_URL ?? new URL(request.url).origin;
	const returnUrl = `${appOrigin}/orders/${orderId}?mollie_return=1`;
	// Mollie calls this back on every status change, so it must be reachable
	// from the internet: on a local dev server, set APP_URL to a public tunnel.
	const webhookUrl = `${appOrigin}/api/gateway/mollie-webhook`;

	try {
		const mollie = createMollieClient({ apiKey: mollieApiKey });
		const payment = await mollie.payments.create({
			amount: {
				currency: currencyCode,
				value: (amountCents / 100).toFixed(2),
			},
			description: `Order ${orderNumber ?? orderId}`,
			redirectUrl: returnUrl,
			webhookUrl,
			metadata: {
				order_id: orderId,
			},
		});

		const checkoutUrl = payment._links.checkout?.href;
		if (!checkoutUrl) {
			return Response.json(
				{ error: "Mollie did not return a checkout URL" },
				{ status: 500 },
			);
		}

		console.log(
			`[gateway/session] Mollie payment created: ${payment.id} for order ${orderId}`,
		);

		return Response.json({
			success: true,
			data: {
				id: payment.id,
				transaction_token: payment.id,
				checkout_url: checkoutUrl,
			},
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(
			"[gateway/session] Failed to create Mollie payment:",
			message,
		);
		return Response.json({ error: message }, { status: 500 });
	}
}
