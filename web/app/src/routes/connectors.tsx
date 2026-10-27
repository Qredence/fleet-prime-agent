import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const ConnectorsPage = lazy(() =>
	import("@/components/connectors/connectors-page").then(({ ConnectorsPage: page }) => ({ default: page })),
);

export const Route = createFileRoute("/connectors")({
	component: () => (
		<Suspense fallback={<PageLoading />}>
			<ConnectorsPage />
		</Suspense>
	),
});

function PageLoading() {
	return (
		<main className="min-h-svh bg-background p-8">
			<p className="mx-auto max-w-5xl text-sm text-muted-foreground">Loading connectors…</p>
		</main>
	);
}
