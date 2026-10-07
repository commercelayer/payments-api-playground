import { Suspense } from "react";
import { GiftCardDebug } from "@/components/gift-card-debug";
import { OrderDetail } from "@/components/order-detail";
import { PaymentSessionsDebug } from "@/components/payment-sessions-debug";
import { PlaceableDebug } from "@/components/placeable-debug";
import { getClientWithToken, hasIntegrationCredentials } from "@/lib/client";
import { DEBUG_PANELS_ENABLED } from "@/lib/debug-panels";

export default async function OrderDetailPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;
	const { accessToken } = await getClientWithToken();

	return (
		<div className="flex flex-col gap-6">
			<OrderDetail orderId={id} accessToken={accessToken} />
			{DEBUG_PANELS_ENABLED && hasIntegrationCredentials() && (
				<>
					<Suspense>
						<GiftCardDebug orderId={id} />
					</Suspense>
					<Suspense>
						<PaymentSessionsDebug orderId={id} />
					</Suspense>
				</>
			)}
			{DEBUG_PANELS_ENABLED && (
				<PlaceableDebug orderId={id} accessToken={accessToken} />
			)}
		</div>
	);
}
