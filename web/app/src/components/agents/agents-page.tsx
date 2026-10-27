import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Activity, ArrowUpRight, Bot, CalendarClock, Clock3, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { chatClient } from "@/components/chat/chat-client";
import { useChatProjects } from "@/components/chat/chat-queries";
import { ProductPageHeader } from "@/components/layout/product-page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function AgentsPage() {
	const [visibleCount, setVisibleCount] = useState(20);
	const projects = useChatProjects();
	const sessions = useQuery({
		queryKey: ["chat", "sessions", "all"],
		queryFn: () => chatClient.listSessions(),
	});
	const projectNames = new Map((projects.data?.projects ?? []).map((project) => [project.projectId, project.name]));
	const sortedSessions = [...(sessions.data ?? [])].sort(
		(left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
	);
	const visibleSessions = sortedSessions.slice(0, visibleCount);

	return (
		<main className="min-h-svh bg-background">
			<ProductPageHeader active="agents" />
			<div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-5 py-10 sm:px-8">
				<div className="max-w-2xl">
					<div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
						<Bot className="size-5" />
					</div>
					<h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
					<p className="mt-2 text-sm leading-6 text-muted-foreground">Review conversations and schedules.</p>
				</div>

				<section aria-labelledby="schedule-heading" className="space-y-3">
					<div>
						<h2 id="schedule-heading" className="text-base font-medium">
							Heartbeat and cron
						</h2>
						<p className="mt-1 text-sm text-muted-foreground">Not supported in Fleet.</p>
					</div>
					<div className="grid gap-3 sm:grid-cols-2">
						<UnavailableScheduleCard icon={<Activity className="size-4" />} title="Heartbeat" />
						<UnavailableScheduleCard icon={<CalendarClock className="size-4" />} title="Cron" />
					</div>
				</section>

				<section aria-labelledby="saved-sessions-heading" className="space-y-3">
					<div className="flex items-end justify-between gap-3">
						<div>
							<h2 id="saved-sessions-heading" className="text-base font-medium">
								Recent sessions
							</h2>
							<p className="mt-1 text-sm text-muted-foreground">Recent conversations.</p>
						</div>
						<Button asChild variant="outline" size="compact">
							<Link to="/">
								Open sessions <ArrowUpRight data-icon="inline-end" />
							</Link>
						</Button>
					</div>
					{sessions.isLoading ? (
						<div className="flex items-center gap-2 py-5 text-sm text-muted-foreground">
							<LoaderCircle className="size-4 animate-spin" /> Loading saved sessions…
						</div>
					) : sessions.isError ? (
						<Alert variant="destructive">
							<AlertTitle>Could not load saved sessions</AlertTitle>
							<AlertDescription>{sessions.error.message}</AlertDescription>
						</Alert>
					) : sortedSessions.length === 0 ? (
						<Card>
							<CardContent className="py-6 text-sm text-muted-foreground">No saved sessions yet.</CardContent>
						</Card>
					) : (
						<div className="grid gap-3 md:grid-cols-2">
							{visibleSessions.map((session) => {
								const sessionTitle = session.title || session.firstMessage || "Untitled session";
								return (
									<Card key={session.sessionId} size="sm" className="min-w-0 overflow-hidden">
										<CardHeader className="min-w-0">
											<div className="flex min-w-0 items-start justify-between gap-3">
												<div className="min-w-0 flex-1">
													<CardTitle className="min-w-0 truncate" title={sessionTitle}>
														{sessionTitle}
													</CardTitle>
													<CardDescription className="mt-1 truncate">
														{session.projectId
															? (projectNames.get(session.projectId) ?? "Project")
															: "Unassigned project"}
														· {session.messageCount} {session.messageCount === 1 ? "message" : "messages"}
													</CardDescription>
												</div>
												<Badge variant="outline" className="capitalize">
													{session.status}
												</Badge>
											</div>
										</CardHeader>
										<CardContent className="flex items-center gap-1.5 text-xs text-muted-foreground">
											<Clock3 className="size-3.5" />
											Updated {formatDate(session.updatedAt)}
										</CardContent>
									</Card>
								);
							})}
						</div>
					)}
					{!sessions.isLoading && !sessions.isError && sortedSessions.length > 20 ? (
						<div className="flex justify-center">
							<Button
								type="button"
								variant="ghost"
								size="compact"
								onClick={() => setVisibleCount((count) => (count >= sortedSessions.length ? 20 : count + 20))}
							>
								{visibleCount >= sortedSessions.length ? "Show fewer sessions" : "Show more sessions"}
							</Button>
						</div>
					) : null}
				</section>
			</div>
		</main>
	);
}

function UnavailableScheduleCard({ icon, title }: { icon: ReactNode; title: string }) {
	return (
		<Card size="sm" className="opacity-80">
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					{icon}
					{title}
				</CardTitle>
			</CardHeader>
			<CardContent>
				<Badge variant="outline">Unavailable</Badge>
			</CardContent>
		</Card>
	);
}

function formatDate(value: string) {
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? "an unknown time" : parsed.toLocaleString();
}
