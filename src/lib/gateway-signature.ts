import { createHmac, timingSafeEqual } from "node:crypto";

export function verifySignature(
	rawBody: string,
	signature: string | null | undefined,
	secret: string,
): boolean {
	if (!signature) return false;
	const expected = Buffer.from(signPayload(rawBody, secret));
	const received = Buffer.from(signature);
	return (
		expected.length === received.length && timingSafeEqual(expected, received)
	);
}

export function signPayload(rawBody: string, secret: string): string {
	return createHmac("sha256", secret).update(rawBody).digest("base64");
}

/** Refuses any call to a gateway route that Commerce Layer didn't sign. The
 * external payment setting signs every request body with its shared secret
 * (HMAC-SHA256, base64) in `X-CommerceLayer-Signature`. The routes spend the
 * Mollie API key on whatever the body asks for, so without a configured secret
 * every call is refused rather than trusted. Returns the error response to
 * send, or null when the call is genuine. */
export function rejectUnsignedRequest(
	route: string,
	rawBody: string,
	request: Request,
): Response | null {
	const secret = process.env.GATEWAY_SHARED_SECRET;
	if (!secret) {
		console.error(`[gateway/${route}] GATEWAY_SHARED_SECRET not configured`);
		return Response.json(
			{ error: "GATEWAY_SHARED_SECRET not configured" },
			{ status: 500 },
		);
	}
	const signature = request.headers.get("X-CommerceLayer-Signature");
	if (!verifySignature(rawBody, signature, secret)) {
		console.error(`[gateway/${route}] Invalid signature`);
		return Response.json({ error: "Invalid signature" }, { status: 401 });
	}
	return null;
}
