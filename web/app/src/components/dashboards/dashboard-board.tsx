import { library as dashboardLibrary, ThemeProvider } from "@openuidev/dashboard-library";
import { library as legacyLibrary, ThemeProvider as LegacyThemeProvider } from "@openuidev/dashboard-library-legacy";
import { type ActionEvent, BuiltinActionType, type ParseResult, Renderer } from "@openuidev/react-lang";
import { LiveArtifactRenderer, OpenUICloudProvider } from "@openuidev/react-ui/cloud";
import type { PrimeAgentArtifact } from "@prime-agent/web-protocol/chat-protocol";
import { type DashboardDataset, projectDashboardDataset } from "@prime-agent/web-protocol/dashboards";
import { EMPTY_SESSION_OUTPUTS } from "@prime-agent/web-protocol/openui-tools";
import { useEffect, useMemo, useState } from "react";
import { useOpenUISession } from "@/components/openui/openui-session-context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { resolveChatApiUrl } from "@/lib/chat/chat-runtime-url";
import { dashboardRecord } from "@/lib/dashboards/dashboard-artifacts";
import { createSessionOutputsToolProvider } from "@/lib/openui/openui-tools";

function useThemeMode(): "light" | "dark" {
	const [mode, setMode] = useState<"light" | "dark">("light");
	useEffect(() => {
		const root = document.documentElement;
		const read = () => setMode(root.classList.contains("dark") ? "dark" : "light");
		read();
		const observer = new MutationObserver(read);
		observer.observe(root, { attributes: true, attributeFilter: ["class"] });
		return () => observer.disconnect();
	}, []);
	return mode;
}

function interpreterUrl(sessionId: string | undefined, dashboardId: string): string {
	const params = new URLSearchParams();
	if (sessionId) params.set("sessionId", sessionId);
	params.set("dashboardId", dashboardId);
	return resolveChatApiUrl(`/api/chat/dashboards/interpreter?${params}`);
}

function createDashboardToolProvider(
	dataset: DashboardDataset | undefined,
	projectId: string | undefined,
	sessionId: string | undefined,
) {
	const sessionOutputs = createSessionOutputsToolProvider(projectId, sessionId).session_outputs;
	return {
		session_outputs: async (args: Record<string, unknown>) => {
			if ((dataset?.rows.length ?? 0) > 0) return EMPTY_SESSION_OUTPUTS;
			return sessionOutputs(args);
		},
		dashboard_rows: async () => projectDashboardDataset(dataset),
	};
}

function boardActionMessage(event: ActionEvent): string | null {
	if (event.type !== BuiltinActionType.ContinueConversation) return null;
	const message = event.params.message;
	if (typeof message === "string" && message.trim()) return message;
	const friendly = event.humanFriendlyMessage.trim();
	return friendly || null;
}

function DashboardContent({
	response,
	program,
	mode,
	url,
	tools,
	onAction,
}: {
	response?: string;
	program?: string;
	mode: "light" | "dark";
	url: string;
	tools: ReturnType<typeof createDashboardToolProvider>;
	onAction: (event: ActionEvent) => void;
}) {
	const [useLegacyLibrary, setUseLegacyLibrary] = useState(false);
	const onParseResult = (result: ParseResult | null) => {
		if (useLegacyLibrary || !result || result.meta.incomplete) return;
		// Cloud content is opaque until the renderer fetches it. Recognize the
		// previous catalog from parser diagnostics, not from raw text or titles.
		const usesLegacyComponents = result.meta.errors.some(
			({ code, component, path }) =>
				(code === "unknown-component" && Object.hasOwn(legacyLibrary.components, component)) ||
				// Section's first argument used to be rows instead of title.
				(code === "type-mismatch" && component === "Section" && path === "/title"),
		);
		if (usesLegacyComponents) setUseLegacyLibrary(true);
	};
	const library = useLegacyLibrary ? legacyLibrary : dashboardLibrary;
	const Theme = useLegacyLibrary ? LegacyThemeProvider : ThemeProvider;
	const content = (
		<Theme mode={mode}>
			{response ? (
				<LiveArtifactRenderer
					response={response}
					library={library}
					interpreter={{ url }}
					preview={false}
					onAction={onAction}
					onParseResult={onParseResult}
					className="w-full"
				/>
			) : (
				<Renderer
					response={program ?? null}
					library={library}
					toolProvider={tools}
					onAction={onAction}
					onParseResult={onParseResult}
				/>
			)}
		</Theme>
	);
	return response ? (
		<OpenUICloudProvider token={resolveChatApiUrl("/api/chat/dashboards/token")}>{content}</OpenUICloudProvider>
	) : (
		content
	);
}

export function DashboardBoard({
	artifact,
	sessionId,
	onOpenUIAction,
}: {
	artifact: PrimeAgentArtifact;
	sessionId?: string;
	onOpenUIAction?: (message: string) => void;
}) {
	const record = useMemo(() => dashboardRecord(artifact), [artifact]);
	const mode = useThemeMode();
	const openUiSession = useOpenUISession();
	const tools = useMemo(
		() =>
			createDashboardToolProvider(
				record?.dataset,
				openUiSession.projectId ?? undefined,
				sessionId ?? openUiSession.sessionId,
			),
		[openUiSession.projectId, openUiSession.sessionId, record?.dataset, sessionId],
	);
	const onAction = (event: ActionEvent) => {
		const message = boardActionMessage(event);
		if (message) onOpenUIAction?.(message);
	};
	if (!record) return <DashboardNotice message="Saved by an older version." />;
	if (record.response || record.program) {
		return (
			<DashboardContent
				key={record.response ?? record.program}
				response={record.response}
				program={record.program}
				mode={mode}
				url={interpreterUrl(sessionId, artifact.id)}
				tools={tools}
				onAction={onAction}
			/>
		);
	}
	if (record.error) return <DashboardNotice message={record.error} />;
	return null;
}

function DashboardNotice({ message }: { message: string }) {
	return (
		<Alert>
			<AlertTitle>Dashboard</AlertTitle>
			<AlertDescription>{message}</AlertDescription>
		</Alert>
	);
}
