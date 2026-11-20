import type {
	ChatMode,
	ChatResourcesResponse,
	ChatSessionResponse,
	ChatThinkingLevel,
	PrimeAgentArtifactRun,
	PrimeAgentSessionPresentation,
	QueueState,
	SessionTreeSnapshot,
	WorkspaceFileResponse,
	WorkspaceTreeResponse,
} from "@prime-agent/web-protocol/chat-protocol";
import type { ChatStatus } from "@prime-agent/web-protocol/chat-types";
import type { RightPanel } from "@/lib/layout/canvas-utils";
import type { ArtifactOpenTarget } from "@/components/layout/use-chat-shell-state";
import type { ChatTranscriptSummary } from "@/lib/sessions/transcript-summary";

export type RightPanelData = {
	activityLabel?: string;
	artifactRuns: Array<PrimeAgentArtifactRun>;
	chatMode: ChatMode;
	loadSubagentSession: (parentSessionId: string, childId: string) => Promise<ChatSessionResponse>;
	transcriptSummary: ChatTranscriptSummary;
	onOpenSubagentTab?: (childId: string) => void;
	onOpenUIAction?: (message: string) => void;
	planLabel?: string;
	presentation: PrimeAgentSessionPresentation;
	queue: QueueState;
	refreshResources: () => void;
	resources: ChatResourcesResponse | null;
	resourcesError: Error | null;
	resourcesLoading: boolean;
	selectedModelKey?: string;
	sessionId?: string;
	status: ChatStatus;
	selectedArtifactId?: string | null;
	openArtifact?: (artifactId: string, target?: ArtifactOpenTarget) => void;
	thinkingLevel?: ChatThinkingLevel;
	reopenRightPanel: () => void;
	rightPanel: RightPanel;
	setRightPanel: (panel: RightPanel) => void;
	sessionTreeSnapshot: SessionTreeSnapshot | null;
	sessionTreeLoading: boolean;
	sessionTreeError: string | null;
	selectedSessionTreeEntryId: string | null;
	isSessionTreeStreaming: boolean;
	refreshSessionTree: () => void;
	selectSessionTreeEntry: (entryId: string, messageId?: string) => void;
	rewindSessionTree: (entryId: string, expectedLeafId: string | null) => Promise<void>;
};

export type WorkspacePanelData = {
	loadWorkspaceFile: (path: string, signal?: AbortSignal) => Promise<WorkspaceFileResponse>;
	refreshWorkspace: () => void;
	selectedWorkspacePath: string | null;
	setSelectedWorkspacePath: (path: string | null) => void;
	workspaceError: Error | null;
	workspaceLoading: boolean;
	workspaceTree: WorkspaceTreeResponse | null;
};
