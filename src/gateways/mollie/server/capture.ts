import { rejectUnsignedRequest } from "@/lib/gateway-signature";

export async function POST(request: Request) {
	const rawBody = await request.text();
	const rejection = rejectUnsignedRequest("capture", rawBody, request);
	if (rejection) return rejection;

	console.log("[gateway/capture] Received:", rawBody);

	// Stub — extend to call Mollie capture API when needed
	return Response.json({
		success: true,
		data: { transaction_token: `capture-${Date.now()}` },
	});
}
