import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
	title: "Payments API Playground",
	description: "A playground for the Commerce Layer payments API",
};

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="en">
			<body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
				<header className="border-b border-gray-200 bg-white">
					<div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
						<span className="text-sm font-semibold tracking-widest text-gray-500 uppercase">
							Commerce Layer
						</span>
						<nav className="flex items-center gap-6">
							<Link
								href="/"
								className="text-sm text-gray-500 hover:text-gray-900"
							>
								Store
							</Link>
						</nav>
					</div>
				</header>
				<main className="mx-auto max-w-3xl px-4 py-10">{children}</main>
			</body>
		</html>
	);
}
