import {
	useChatMcpConnections,
	useMcpOAuth,
	useRemoveMcpConnection,
	useUpdateMcpConnection,
} from "@/components/chat/chat-queries";
import { ProductPageHeader } from "@/components/layout/product-page-header";
import { McpConnectionsSection } from "@/components/settings/mcp/mcp-connections-section";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function ConnectorsPage() {
	const connections = useChatMcpConnections();
	const update = useUpdateMcpConnection();
	const remove = useRemoveMcpConnection();
	const oauth = useMcpOAuth();

	return (
		<main className="min-h-svh bg-background">
			<ProductPageHeader active="connectors" />
			<div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-5 py-10 sm:px-8">
				<h1 className="text-2xl font-semibold tracking-tight">Connectors</h1>
				{connections.isError ? (
					<Alert variant="destructive">
						<AlertTitle>Could not load connectors</AlertTitle>
						<AlertDescription>{connections.error.message}</AlertDescription>
					</Alert>
				) : null}
				<McpConnectionsSection
					connections={connections.data?.connections ?? []}
					description="Connect Model Context Protocol (MCP) servers. For bearer sign-in, enter the name of the server's environment variable that contains your secret. You cannot enter the secret here."
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
