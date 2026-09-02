import type {
	ChatMode,
	ChatThinkingLevel,
	PrimeAgentArtifactRun,
	PrimeAgentGoal,
	PrimeAgentSessionPresentation,
	QueueState,
} from "@prime-agent/web-protocol/chat-protocol";
import type { ChatMessage, ChatStatus } from "@prime-agent/web-protocol/chat-types";

export type SessionInsightsInput = {
	activityLabel?: string;
	artifactRuns: Array<PrimeAgentArtifactRun>;
	chatMode: ChatMode;
	messages: Array<ChatMessage>;
	planLabel?: string;
	presentation: PrimeAgentSessionPresentation;
	queue: QueueState;
	selectedModelKey?: string;
	sessionId?: string;
	status: ChatStatus;
	thinkingLevel?: ChatThinkingLevel;
};

export const RLM_CHILD_STATUSES = ["queued", "running", "done", "error", "cancelled"] as const;

export type SessionInsights = {
	activity: string;
	artifactCount: number;
	assistantMessages: number;
	bashCommands: number;
	goal?: PrimeAgentGoal;
	ipythonCells: number;
	queuedFollowUps: number;
	queuedSteering: number;
	refinements: { failed: number; successful: number; total: number };
	rlmChildren: Record<(typeof RLM_CHILD_STATUSES)[number], number>;
	userMessages: number;
};

/**
 * Aggregates session activity, message, artifact, refinement, child-run, and queue insights.
 *
 * @param activityLabel - The current activity label, used before the plan label.
 * @param artifactRuns - Artifact runs whose artifacts are included in the counts.
 * @param messages - Session messages to count by role.
 * @param planLabel - The fallback activity label.
 * @param presentation - Session presentation data used for goals, refinements, child runs, and tool activity.
 * @param queue - Queued follow-up and steering items.
 * @returns The derived session insights.
 */
export function deriveSessionInsights({
	activityLabel,
	artifactRuns,
	messages,
	planLabel,
	presentation,
	queue,
}: Pick<
	SessionInsightsInput,
	"activityLabel" | "artifactRuns" | "messages" | "planLabel" | "presentation" | "queue"
>): SessionInsights {
	const rlmChildren = Object.fromEntries(
		RLM_CHILD_STATUSES.map((status) => [status, 0]),
	) as SessionInsights["rlmChildren"];
	for (const child of presentation.rlmChildren) rlmChildren[child.status] += 1;

	const refinements = presentation.refinements.reduce(
		(counts, refinement) => ({
			failed: counts.failed + Number(refinement.status === "error"),
			successful: counts.successful + Number(refinement.status === "success"),
			total: counts.total + 1,
		}),
		{ failed: 0, successful: 0, total: 0 },
	);
	const artifacts = artifactRuns.flatMap((run) => run.artifacts);

	return {
		activity: activityLabel || planLabel || "Waiting for input",
		artifactCount: artifacts.length,
		assistantMessages: messages.filter((message) => message.role === "assistant").length,
		bashCommands: presentation.userBash.length,
		goal: presentation.goal,
		ipythonCells: artifacts.filter((artifact) => artifact.kind === "ipython").length,
		queuedFollowUps: queue.followUp.length,
		queuedSteering: queue.steering.length,
		refinements,
		rlmChildren,
		userMessages: messages.filter((message) => message.role === "user").length,
	};
}
