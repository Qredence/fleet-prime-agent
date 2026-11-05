import type { ChatProviderInfo } from "@prime-agent/web-protocol/chat-protocol";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function ProviderOAuthTerminalFallback({ provider }: { provider: ChatProviderInfo }) {
	return (
		<Alert className="px-3 py-2">
			<AlertDescription className="text-xs text-pretty">
				Sign-in has to run inside Prime Agent. In a terminal, start Prime Agent against the same account as Fleet,
				then run <code className="rounded bg-muted px-1 py-0.5 font-mono text-caption text-foreground">/login</code>{" "}
				and choose {provider.name}. Fleet reads the stored credential on every request, so a restart is not needed.
				If Fleet uses a non-default account directory, start Prime Agent with the same{" "}
				<code className="rounded bg-muted px-1 py-0.5 font-mono text-caption text-foreground">
					PRIME_AGENT_CODING_AGENT_DIR
				</code>{" "}
				it uses.
			</AlertDescription>
		</Alert>
	);
}
