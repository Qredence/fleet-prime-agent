import type { ChatProviderInfo } from "@prime-agent/web-protocol/chat-protocol";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function ProviderOAuthTerminalFallback({ provider }: { provider: ChatProviderInfo }) {
	return (
		<Alert className="px-3 py-2">
			<AlertDescription className="text-xs text-pretty">
				OAuth sign-in from Fleet settings is unavailable. Launch Prime Agent in a terminal using the same
				configuration directory as Fleet and complete {provider.name} sign-in there. Restart Fleet afterward to
				reload the credentials.
			</AlertDescription>
		</Alert>
	);
}
