import { McpConnectionsSection } from "@/components/connectors/mcp-connections-section";
import { ProductPageHeader } from "@/components/layout/product-page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
	useChatMcpConnections,
	useMcpOAuth,
	useRemoveMcpConnection,
	useUpdateMcpConnection,
} from "@/hooks/chat/chat-queries";

export function ConnectorsPage() {
	const connections = useChatMcpConnections();
	const update = useUpdateMcpConnection();
	const remove = useRemoveMcpConnection();
	const oauth = useMcpOAuth();

	return (
		<main className="min-h-svh bg-background">
			<ProductPageHeader active="connectors" />
			<div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-5 py-10 sm:px-8">
				<h1 className="text-xl font-semibold tracking-tight">Connectors</h1>
				{connections.isError ? (
					<Alert variant="destructive">
						<AlertTitle>Could not load connectors</AlertTitle>
						<AlertDescription>{connections.error.message}</AlertDescription>
					</Alert>
				) : null}
				<McpConnectionsSection
					connections={connections.data?.connections ?? []}
					description="Connect Model Context Protocol (MCP) servers for Prime Agent. Manage setup and sign-in from each server’s details."
					isLoading={connections.isLoading}
					isPending={update.isPending || remove.isPending || oauth.isPending}
					onOAuth={(request) => oauth.mutateAsync(request)}
					onRemove={(request) => remove.mutateAsync(request)}
					onUpsert={(request) => update.mutateAsync(request)}
					title="Servers"
				/>
			</div>
		</main>
	);
}
