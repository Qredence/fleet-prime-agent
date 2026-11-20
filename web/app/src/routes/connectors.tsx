import { createFileRoute } from "@tanstack/react-router";
import { ConnectorsPage } from "@/routes/-connectors-page";

export const Route = createFileRoute("/connectors")({
	component: ConnectorsPage,
	pendingComponent: PageLoading,
	pendingMs: 0,
	pendingMinMs: 0,
});

function PageLoading() {
	return (
		<main className="min-h-svh bg-background p-8">
			<p className="mx-auto max-w-5xl text-sm text-muted-foreground">Loading connectors…</p>
		</main>
	);
}
