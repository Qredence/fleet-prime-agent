import type { ProjectId, ProjectSummary } from "@prime-agent/web-protocol";
import type { ChatSessionInfo } from "@prime-agent/web-protocol/chat-protocol";
import { Folder } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { normalizeSessionLabel } from "@/lib/chat/chat-helpers";
import { sessionDiscoveryMeta, sessionLabel, sessionSearchGroup, sortSessions } from "@/lib/sessions/sidebar-types";
import { cn } from "@/lib/utils";

type SearchableThread = {
	id: string;
	title: string;
	group: string;
	preview: string;
	keywords: readonly string[];
};

export interface ThreadSearchPopoverProps {
	activeSessionId?: string;
	projectById: Map<ProjectId, ProjectSummary>;
	projectSessions: Array<ChatSessionInfo>;
	query: string;
	selectSearchResult: (value: string) => void;
	setQuery: (query: string) => void;
	sortedProjects: Array<ProjectSummary>;
}

function KbdHint({ children }: { children: ReactNode }) {
	return (
		<kbd className="rounded border border-border/60 bg-muted/60 px-1 font-mono text-xs leading-4 text-muted-foreground">
			{children}
		</kbd>
	);
}

export function ThreadSearchPopover({
	activeSessionId,
	projectById,
	projectSessions,
	query,
	selectSearchResult,
	setQuery,
	sortedProjects,
}: ThreadSearchPopoverProps) {
	const searchThreads = useMemo<Array<SearchableThread>>(
		() =>
			sortSessions(projectSessions).map((session) => ({
				id: session.sessionId,
				title: sessionLabel(session, projectSessions),
				preview: sessionDiscoveryMeta(session, projectById),
				group: sessionSearchGroup(session.updatedAt),
				// Keep the initial prompt searchable; a renamed session no longer
				// matches its own first message otherwise (combobox keyword parity).
				keywords: session.firstMessage ? [normalizeSessionLabel(session.firstMessage)] : [],
			})),
		[projectById, projectSessions],
	);
	const matchingThreads = useMemo(() => {
		const needle = query.trim().toLowerCase();
		if (!needle) return searchThreads;
		return searchThreads.filter((thread) =>
			`${thread.title} ${thread.preview} ${thread.keywords.join(" ")}`.toLowerCase().includes(needle),
		);
	}, [query, searchThreads]);
	const threadGroups = useMemo(() => [...new Set(matchingThreads.map((thread) => thread.group))], [matchingThreads]);
	const matchingProjects = useMemo(() => {
		const needle = query.trim().toLowerCase();
		if (!needle) return sortedProjects;
		return sortedProjects.filter((project) => `${project.name} ${project.pathLabel}`.toLowerCase().includes(needle));
	}, [query, sortedProjects]);

	return (
		<Command data-slot="thread-search" shouldFilter={false} className="rounded-none bg-popover p-0">
			<CommandInput
				value={query}
				onValueChange={setQuery}
				placeholder="Search threads"
				aria-label="Search threads"
			/>
			<CommandList className="max-h-[min(28rem,calc(100dvh-9rem))] p-1">
				{matchingThreads.length === 0 ? (
					<p className="px-2 py-3 text-center text-xs text-muted-foreground">No thread matches “{query}”</p>
				) : (
					threadGroups.map((group) => (
						<CommandGroup key={group} heading={group}>
							{matchingThreads
								.filter((thread) => thread.group === group)
								.map((thread) => (
									<CommandItem
										key={thread.id}
										value={`session:${thread.id}:${thread.title}`}
										onSelect={() => selectSearchResult(`search-session:${thread.id}`)}
										className={cn(
											"items-start gap-2 py-1.5",
											thread.id === activeSessionId && "bg-foreground/[0.04]",
										)}
									>
										<div className="flex min-w-0 flex-1 flex-col gap-0.5">
											<span className="truncate text-sm text-foreground">{thread.title}</span>
											<span className="truncate text-xs text-muted-foreground">{thread.preview}</span>
										</div>
									</CommandItem>
								))}
						</CommandGroup>
					))
				)}
				<CommandGroup heading="Projects">
					{matchingProjects.length === 0 ? (
						<p className="p-2 text-center text-xs text-muted-foreground">No project matches “{query}”</p>
					) : (
						matchingProjects.map((project) => (
							<CommandItem
								key={project.projectId}
								value={`project:${project.projectId}:${project.name}`}
								onSelect={() => selectSearchResult(`search-project:${project.projectId}`)}
								className="gap-2 py-1.5 text-xs"
							>
								<Folder className="size-3.5 shrink-0 text-muted-foreground/60" />
								<span className="min-w-0 flex-1 truncate">{project.name}</span>
								<span className="max-w-24 truncate text-xs text-muted-foreground/55">{project.pathLabel}</span>
							</CommandItem>
						))
					)}
				</CommandGroup>
			</CommandList>
			<div className="flex items-center justify-end gap-3 border-t border-border/60 px-3 py-2 text-xs text-muted-foreground/70">
				<span className="flex items-center gap-1">
					<KbdHint>↑</KbdHint>
					<KbdHint>↓</KbdHint>
					navigate
				</span>
				<span className="flex items-center gap-1">
					<KbdHint>↵</KbdHint>
					open
				</span>
				<span className="flex items-center gap-1">
					<KbdHint>esc</KbdHint>
					close
				</span>
			</div>
		</Command>
	);
}
