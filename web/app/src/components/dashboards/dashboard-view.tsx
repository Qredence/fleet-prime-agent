import type { PrimeAgentArtifact } from "@prime-agent/web-protocol/chat-protocol";
import {
	type DashboardFence,
	type DashboardRecord,
	dashboardFenceKey,
	dashboardFences,
} from "@prime-agent/web-protocol/dashboards";
import { LayoutDashboard } from "lucide-react";
import { useContext } from "react";
import { dashboardRecord, mergeArtifactsById } from "@/lib/dashboards/dashboard-artifacts";
import { DashboardRequestContext } from "@/components/dashboards/dashboard-request-context";
import {
	Attachment,
	AttachmentContent,
	AttachmentDescription,
	AttachmentMedia,
	AttachmentTitle,
	AttachmentTrigger,
} from "@/components/ui/attachment";

function artifactForFence(
	artifacts: readonly PrimeAgentArtifact[],
	fence: DashboardFence,
	messageId: string | undefined,
): PrimeAgentArtifact | undefined {
	const fenceKey = dashboardFenceKey(fence);
	const matches = artifacts.filter((artifact) => {
		if (artifact.kind !== "openui-dashboard") return false;
		const record = dashboardRecord(artifact);
		if (record?.fenceKey === fenceKey) return true;
		if (fence.id !== undefined && (artifact.id === fence.id || record?.dashboardId === fence.id)) return true;
		// An unreadable board has no fence key. The message is the only link.
		return !record && messageId !== undefined && artifact.sourceMessageId === messageId;
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
 * The first dashboard fence in a message becomes one attachment. The server
 * settles that same fence. Later fences stay visible as a notice instead of
 * another board. The trigger opens the Dashboards tab, which draws the board.
 */
export function DashboardRequestCard({ content, messageId }: { content: string; messageId?: string }) {
	const fences = dashboardFences(content);
	const fence = fences[0];
	const panel = useContext(DashboardRequestContext);
	if (!fence) return null;
	const artifacts = panel ? mergeArtifactsById(panel.artifactRuns, panel.presentation?.artifactRuns) : [];
	const open = (artifactId: string | undefined) => {
		if (artifactId && panel?.openArtifact) {
			panel.openArtifact(artifactId, "dashboards");
			return;
		}
		panel?.setRightPanel("dashboards");
	};
	const attachment = (
		<DashboardAttachment fence={fence} artifact={artifactForFence(artifacts, fence, messageId)} onOpen={open} />
	);
	if (fences.length === 1) return attachment;
	return (
		<div className="flex flex-col gap-2">
			{attachment}
			<p className="text-xs text-muted-foreground">
				This message asked for more than one dashboard. Fleet opens the first.
			</p>
		</div>
	);
}
