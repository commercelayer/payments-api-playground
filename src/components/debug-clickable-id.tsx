"use client";

export function DebugClickableId({ id, data }: { id: string; data: unknown }) {
	return (
		<button
			type="button"
			className="cursor-pointer font-mono text-xs text-amber-600/70 hover:text-amber-800"
			onClick={() => console.log(data)}
		>
			{id}
		</button>
	);
}
