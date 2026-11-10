import { library as dashboardLibrary, ThemeProvider } from "@openuidev/dashboard-library";
import { type ActionEvent, BuiltinActionType, Renderer } from "@openuidev/react-lang";
import { LiveArtifactRenderer, OpenUICloudProvider } from "@openuidev/react-ui/cloud";
import type { PrimeAgentArtifact } from "@prime-agent/web-protocol/chat-protocol";
import {
	type DashboardDataset,
	type DashboardFence,
	type DashboardRecord,
	DashboardRecordSchema,
	dashboardFenceKey,
	dashboardFences,
	projectDashboardDataset,
} from "@prime-agent/web-protocol/dashboards";
import { EMPTY_SESSION_OUTPUTS } from "@prime-agent/web-protocol/openui-tools";
import { LayoutDashboard } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { mergeArtifactsById } from "@/components/dashboards/dashboard-artifacts";
import { useOptionalChatPanelDataContext } from "@/components/layout/right-panel-context";
import { useOpenUISession } from "@/components/openui/openui-session-context";
import { createSessionOutputsToolProvider } from "@/components/openui/openui-tools";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
	Attachment,
	AttachmentContent,
	AttachmentDescription,
	AttachmentGroup,
	AttachmentMedia,
	AttachmentTitle,
	AttachmentTrigger,
} from "@/components/ui/attachment";

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

export function dashboardRecord(artifact: PrimeAgentArtifact): DashboardRecord | undefined {
	if (artifact.kind !== "openui-dashboard") return undefined;
	const parsed = DashboardRecordSchema.safeParse(artifact.output);
	return parsed.success ? parsed.data : undefined;
}

function interpreterUrl(sessionId: string | undefined, dashboardId: string): string {
	const params = new URLSearchParams();
	if (sessionId) params.set("sessionId", sessionId);
	params.set("dashboardId", dashboardId);
	return `/api/chat/dashboards/interpreter?${params}`;
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

export function DashboardBoard({
	artifact,
	sessionId,
	onOpenUIAction,
}: {
	artifact: PrimeAgentArtifact;
	sessionId?: string;
	onOpenUIAction?: (message: string) => void;
}) {
	const record = dashboardRecord(artifact);
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
	if (!record) {
		return <DashboardNotice title="Dashboard" message="Saved by an older version." />;
	}
	if (record.response) {
		return (
			<ThemeProvider mode={mode}>
				<OpenUICloudProvider token="/api/chat/dashboards/token">
					<LiveArtifactRenderer
						response={record.response}
						library={dashboardLibrary}
						interpreter={{ url: interpreterUrl(sessionId, artifact.id) }}
						preview={false}
						onAction={onAction}
						className="w-full"
					/>
				</OpenUICloudProvider>
			</ThemeProvider>
		);
	}
	if (record.program) {
		return (
			<ThemeProvider mode={mode}>
				<Renderer response={record.program} library={dashboardLibrary} toolProvider={tools} onAction={onAction} />
			</ThemeProvider>
		);
	}
	if (record.error) return <DashboardNotice title="Dashboard" message={record.error} />;
	return null;
}

function DashboardNotice({ title, message }: { title: string; message: string }) {
	return (
		<Alert>
			<AlertTitle>{title}</AlertTitle>
			<AlertDescription>{message}</AlertDescription>
		</Alert>
	);
}

function artifactForFence(
	artifacts: readonly PrimeAgentArtifact[],
	fence: DashboardFence,
	messageId: string | undefined,
): PrimeAgentArtifact | undefined {
	const fenceKey = dashboardFenceKey(fence);
	const matches = artifacts.filter((artifact) => {
		if (artifact.kind !== "openui-dashboard") return false;
		const record = dashboardRecord(artifact);
		if (messageId && artifact.sourceMessageId === messageId) return true;
		if (record?.fenceKey === fenceKey) return true;
		return fence.id !== undefined && (artifact.id === fence.id || record?.dashboardId === fence.id);
	});
	return (
		matches.find((artifact) => {
			const record = dashboardRecord(artifact);
			return Boolean(record?.response || record?.program);
		}) ?? matches.at(-1)
	);
}

function attachmentCopy(
	fence: DashboardFence,
	record: DashboardRecord | undefined,
	unreadable: boolean,
): { state: "processing" | "error" | "done"; description: string } {
	if (unreadable) return { state: "error", description: "Saved by an older version." };
	if (record?.error) return { state: "error", description: record.error };
	if (record?.response) return { state: "done", description: "OpenUI Cloud" };
	if (fence.program || record?.program) return { state: "done", description: "Dashboard" };
	if (fence.prompt) return { state: "processing", description: "Building the dashboard…" };
	return { state: "done", description: "Dashboard" };
}

function DashboardAttachment({
	fence,
	artifact,
	onOpen,
}: {
	fence: DashboardFence;
	artifact: PrimeAgentArtifact | undefined;
	onOpen: (artifactId: string | undefined) => void;
}) {
	const record = artifact ? dashboardRecord(artifact) : undefined;
	const unreadable = Boolean(artifact) && !record;
	const title = fence.title ?? artifact?.title ?? "Dashboard";
	const { state, description } = attachmentCopy(fence, record, unreadable);
	return (
		<Attachment state={state} size="sm" orientation="horizontal">
			<AttachmentMedia>
				<LayoutDashboard />
			</AttachmentMedia>
			<AttachmentContent>
				<AttachmentTitle>{title}</AttachmentTitle>
				<AttachmentDescription>{description}</AttachmentDescription>
			</AttachmentContent>
			<AttachmentTrigger
				aria-label={`Open ${title}`}
				onClick={() => onOpen(unreadable ? undefined : artifact?.id)}
			/>
		</Attachment>
	);
}

/**
 * One attachment per dashboard fence. The trigger opens the Dashboards tab.
 * The board itself is drawn in that tab.
 */
export function DashboardRequestCard({ content, messageId }: { content: string; messageId?: string }) {
	const fences = dashboardFences(content);
	const panel = useOptionalChatPanelDataContext();
	if (fences.length === 0) return null;
	const artifacts = panel ? mergeArtifactsById(panel.artifactRuns, panel.presentation?.artifactRuns) : [];
	const open = (artifactId: string | undefined) => {
		if (artifactId && panel?.openArtifact) {
			panel.openArtifact(artifactId, "dashboards");
			return;
		}
		panel?.setRightPanel("dashboards");
	};
	const attachments = fences.map((fence) => (
		<DashboardAttachment
			key={dashboardFenceKey(fence)}
			fence={fence}
			artifact={artifactForFence(artifacts, fence, messageId)}
			onOpen={open}
		/>
	));
	if (attachments.length === 1) return attachments[0] ?? null;
	return <AttachmentGroup>{attachments}</AttachmentGroup>;
}
