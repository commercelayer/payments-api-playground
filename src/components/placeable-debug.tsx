import { PlaceableDebugCheck } from "./placeable-debug-check";

export function PlaceableDebug({
	orderId,
	accessToken,
}: {
	orderId: string;
	accessToken: string;
}) {
	return (
		<section className="rounded-2xl border border-dashed border-amber-300 bg-amber-50">
			<PlaceableDebugCheck orderId={orderId} accessToken={accessToken} />
		</section>
	);
}
