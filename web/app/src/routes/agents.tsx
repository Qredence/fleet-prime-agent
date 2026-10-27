import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const AgentsPage = lazy(() =>
	import("@/components/agents/agents-page").then(({ AgentsPage: page }) => ({ default: page })),
);

export const Route = createFileRoute("/agents")({
	component: () => (
		<Suspense fallback={<PageLoading />}>
			<AgentsPage />
		</Suspense>
	),
});

function PageLoading() {
	return (
		<main className="min-h-svh bg-background p-8">
			<p className="mx-auto max-w-5xl text-sm text-muted-foreground">Loading agents…</p>
		</main>
	);
}
