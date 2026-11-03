import type { PrimeAgentArtifactRun, PrimeAgentRlmChild } from "@prime-agent/web-protocol/chat-protocol";
import type { ChatMessage, ChatReasoningPart } from "@prime-agent/web-protocol/chat-types";
import { ArrowUpRight, CircleCheck, CircleDashed, CircleX, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { groupMessages } from "@/components/chat/transcript/conversation-turns";
import { ReasoningLine } from "@/components/chat/transcript/reasoning-line";
import { ToolTimeline } from "@/components/tools/tool-timeline";
import { Button } from "@/components/ui/button";
import {
	Trace,
	TraceCollapsible,
	TraceCollapsibleContent,
	TraceCollapsibleTrigger,
	TraceDescription,
	TraceIcon,
	TraceLine,
	TraceTitle,
} from "@/components/ui/trace";

function messageText(message: ChatMessage): string {
	return message.parts
		.filter((part) => part.type === "text")
		.map((part) => (part.type === "text" ? part.text : ""))
		.join(" ")
		.trim();
}

function isReasoningPart(part: ChatMessage["parts"][number]): part is ChatReasoningPart {
	return part.type === "reasoning";
}

function childStatusIcon(status: PrimeAgentRlmChild["status"]) {
	if (status === "done") return CircleCheck;
	if (status === "error" || status === "failed" || status === "cancelled") return CircleX;
	return CircleDashed;
}

function reasoningPreview(text: string): string {
	const compact = text.replace(/\s+/g, " ").trim();
	if (compact.length <= 140) return compact;
	return `${compact.slice(0, 137).trimEnd()}…`;
}

function TurnReasoningSummary({ parts, streaming }: { parts: Array<ChatReasoningPart>; streaming: boolean }) {
	const [userOpen, setUserOpen] = useState<boolean | undefined>();
	if (parts.length === 0) return null;
	if (parts.length === 1) {
		const part = parts[0]!;
		return (
			<ReasoningLine
				text={part.text}
				streaming={streaming && part.state === "streaming"}
				durationMs={part.durationMs}
			/>
		);
	}

	const active = streaming && parts.some((part) => part.state === "streaming");
	const durationMs = parts.reduce(
		(total, part) => total + (typeof part.durationMs === "number" ? part.durationMs : 0),
		0,
	);
	const previews = parts.map((part) => reasoningPreview(part.text)).filter(Boolean);

	return (
		<Trace data-testid="reasoning-summary">
			<TraceCollapsible open={userOpen ?? active} onOpenChange={setUserOpen}>
				<TraceCollapsibleTrigger>
					<TraceLine status={active ? "running" : undefined}>
						<TraceIcon>
							{active ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <CircleCheck />}
						</TraceIcon>
						<TraceTitle>{active ? "Thinking" : "Thought"}</TraceTitle>
						<TraceDescription>
							{parts.length}
							{durationMs > 0 ? ` · ${Math.max(0, Math.round(durationMs / 1000))}s` : ""}
						</TraceDescription>
					</TraceLine>
				</TraceCollapsibleTrigger>
				<TraceCollapsibleContent>
					<p className="mb-2 text-xs text-muted-foreground">
						{parts.length} reasoning steps in this turn. Full interleaved detail is on the Main agent transcript.
					</p>
					{previews.length > 0 ? (
						<ol className="flex max-h-40 flex-col gap-1.5 overflow-y-auto overscroll-contain">
							{previews.map((preview, index) => (
								<li className="text-xs text-foreground/80" key={`reasoning-preview-${index}`}>
									<span className="font-medium text-muted-foreground">{index + 1}. </span>
									{preview}
								</li>
							))}
						</ol>
					) : null}
				</TraceCollapsibleContent>
			</TraceCollapsible>
		</Trace>
	);
}

export function SessionActivityPanel({
	artifactRuns,
	childAgents,
	messages,
	onOpenArtifact,
	onSelectChild,
	streaming,
}: {
	artifactRuns: Array<PrimeAgentArtifactRun>;
	childAgents: Array<PrimeAgentRlmChild>;
	messages: Array<ChatMessage>;
	onOpenArtifact: (artifactId: string, target?: "artifacts" | "repl") => void;
	onSelectChild: (childId: string) => void;
	streaming: boolean;
}) {
	const artifacts = artifactRuns.flatMap((run) => run.artifacts);
	const turns = groupMessages(messages);
	const assignedArtifacts = new Set<string>();
	const renderMessage = (message: ChatMessage) => {
		const text = messageText(message);
		if (!text) return null;
		return (
			<div className="rounded-md border border-border/60 bg-background/60 px-3 py-2" key={message.id}>
				<div className="mb-1 text-micro font-medium uppercase tracking-wide text-muted-foreground">
					{message.role === "user" ? "You" : "Assistant"}
				</div>
				<p className="line-clamp-2 whitespace-pre-wrap break-words text-xs text-foreground/80">{text}</p>
			</div>
		);
	};

	return (
		<div
			className="mx-auto flex w-full max-w-4xl min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-5"
			data-testid="session-activity"
		>
			<section aria-labelledby="activity-messages-heading">
				<h2 className="mb-2 text-sm font-semibold" id="activity-messages-heading">
					Conversation activity
				</h2>
				{turns.length ? (
					<ol className="space-y-4">
						{turns.map((turn, index) => {
							const assistantIds = new Set(turn.assistants.map((message) => message.id));
							const toolCallIds = new Set(
								turn.assistants.flatMap((message) =>
									message.parts.flatMap((part) =>
										part.type.startsWith("tool-") &&
										"toolCallId" in part &&
										typeof part.toolCallId === "string"
											? [part.toolCallId]
											: [],
									),
								),
							);
							const turnArtifacts = artifacts.filter((artifact) => {
								const matchesMessage =
									artifact.sourceMessageId !== undefined && assistantIds.has(artifact.sourceMessageId);
								const matchesTool =
									artifact.sourceToolCallId !== undefined && toolCallIds.has(artifact.sourceToolCallId);
								if (!matchesMessage && !matchesTool) return false;
								assignedArtifacts.add(artifact.id);
								return true;
							});
							return (
								<li
									className="space-y-2 border-b border-border/50 pb-4 last:border-b-0"
									key={turn.user?.id ?? turn.assistants[0]?.id ?? index}
								>
									{turn.user ? renderMessage(turn.user) : null}
									<TurnReasoningSummary
										parts={turn.assistants.flatMap((message) => message.parts.filter(isReasoningPart))}
										streaming={streaming && index === turns.length - 1}
									/>
									<ToolTimeline
										messages={turn.assistants}
										artifacts={turnArtifacts}
										streaming={streaming && index === turns.length - 1}
										onOpenArtifact={onOpenArtifact}
									/>
									{turn.assistants.map(renderMessage)}
								</li>
							);
						})}
					</ol>
				) : (
					<p className="text-xs text-muted-foreground">No conversation activity yet.</p>
				)}
			</section>

			<section aria-labelledby="activity-tools-heading">
				<h2 className="mb-2 text-sm font-semibold" id="activity-tools-heading">
					Tool and artifact activity
				</h2>
				<ToolTimeline
					messages={[]}
					artifacts={artifacts.filter((artifact) => !assignedArtifacts.has(artifact.id))}
					streaming={streaming}
					onOpenArtifact={onOpenArtifact}
				/>
				{artifacts.length === 0 &&
				!messages.some((message) => message.parts.some((part) => part.type.startsWith("tool-"))) ? (
					<p className="text-xs text-muted-foreground">No tool or artifact activity yet.</p>
				) : null}
			</section>

			<section aria-labelledby="activity-agents-heading">
				<h2 className="mb-2 text-sm font-semibold" id="activity-agents-heading">
					Child agents
				</h2>
				{childAgents.length ? (
					<ul className="space-y-1.5">
						{childAgents.map((child) => {
							const StatusIcon = childStatusIcon(child.status);
							return (
								<li key={child.id}>
									<Button
										aria-label={`Open ${child.sessionName || child.label} agent tab`}
										className="h-auto min-h-7 w-full min-w-0 justify-start gap-2 rounded-full border border-border/60 bg-background/60 px-3 py-2 text-left text-foreground hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring"
										onClick={() => onSelectChild(child.id)}
										size="compact"
										type="button"
										variant="ghost"
									>
										<StatusIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
										<span className="min-w-0 flex-1">
											<span className="block truncate text-xs font-medium">
												{child.sessionName || child.label}
											</span>
											<span className="block truncate text-micro text-muted-foreground">
												{[child.status, child.model, child.progressNote || child.answerPreview]
													.filter(Boolean)
													.join(" · ")}
											</span>
										</span>
										<ArrowUpRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
									</Button>
								</li>
							);
						})}
					</ul>
				) : (
					<p className="text-xs text-muted-foreground">No child agents in this session.</p>
				)}
			</section>
		</div>
	);
}
