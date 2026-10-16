"use client";

import { AlertCircle, Clock3, Gauge, ListRestart, RotateCcw } from "lucide-react";
import { m, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { EASE_IN_OUT } from "@/lib/ease";
import { mono } from "@/lib/surfaces";
import { cn } from "@/lib/utils";

export type TurnStatusKind = "queue" | "retry" | "compaction" | "recovery" | "notice";

const GRID_CELLS = [
	{ id: "top-left", delay: 0 },
	{ id: "top-center", delay: 0.14 },
	{ id: "top-right", delay: 0.28 },
	{ id: "middle-left", delay: 0.42 },
	{ id: "middle-center", delay: 0.56 },
	{ id: "middle-right", delay: 0.7 },
	{ id: "bottom-left", delay: 0.84 },
	{ id: "bottom-center", delay: 0.98 },
	{ id: "bottom-right", delay: 1.12 },
];

function formatElapsed(totalSeconds: number) {
	const safeSeconds = Math.max(0, totalSeconds);
	const minutes = Math.floor(safeSeconds / 60);
	const seconds = (safeSeconds % 60).toFixed(1);
	return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function AgentProgress({
	label = "Churning",
	elapsedSeconds,
	initialSeconds = 0,
	running = true,
	className,
}: {
	label?: string;
	elapsedSeconds?: number;
	initialSeconds?: number;
	running?: boolean;
	className?: string;
}) {
	const reduce = useReducedMotion() ?? false;
	const [internalSeconds, setInternalSeconds] = useState(initialSeconds);

	useEffect(() => {
		if (elapsedSeconds !== undefined || !running) return;

		const startedAt = performance.now() - initialSeconds * 1000;
		const timer = window.setInterval(() => {
			setInternalSeconds((performance.now() - startedAt) / 1000);
		}, 100);

		return () => window.clearInterval(timer);
	}, [elapsedSeconds, initialSeconds, running]);

	const elapsed = elapsedSeconds ?? internalSeconds;

	return (
		<span
			role="status"
			aria-label={`${label}, in progress`}
			className={cn("inline-flex items-center gap-2.5 text-sm text-muted-foreground", className)}
		>
			<span aria-hidden="true" className="grid size-5 shrink-0 grid-cols-3 gap-[2px]">
				{GRID_CELLS.map(({ id, delay }) => (
					<m.span
						key={id}
						className="rounded-[1px] bg-current"
						animate={
							reduce
								? { opacity: [0.35, 0.8, 0.35] }
								: {
										opacity: [0.28, 1, 0.28],
										scale: [0.72, 1, 0.72],
									}
						}
						transition={{
							duration: 1.55,
							ease: EASE_IN_OUT,
							repeat: Infinity,
							delay,
						}}
					/>
				))}
			</span>
			<span className="font-medium text-foreground/80">{label}</span>
			<span aria-hidden="true" className={cn(mono, "tabular-nums text-muted-foreground/70")}>
				{formatElapsed(elapsed)}
			</span>
		</span>
	);
}

/** Lifecycle copy around AgentProgress for turn-level status. */
export function TurnStatus({ label, className }: { label?: string; className?: string }) {
	const reduceMotion = useReducedMotion();
	if (!label?.trim()) return null;
	const { kind, title, detail } = describeTurnStatus(label);
	const Icon = iconFor(kind);
	const liveProgress = kind === "queue" || kind === "retry" || kind === "compaction";

	return (
		<m.div
			initial={reduceMotion ? false : { opacity: 0, y: -4 }}
			animate={{ opacity: 1, y: 0 }}
			exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
			transition={{ duration: reduceMotion ? 0 : 0.16 }}
			role={kind === "recovery" ? "status" : undefined}
			aria-live={kind === "recovery" ? "polite" : "off"}
			className={cn(
				"flex items-start gap-2 rounded-lg border border-border/60 bg-muted/45 px-3 py-2 text-xs text-muted-foreground",
				className,
			)}
		>
			{liveProgress ? (
				<AgentProgress label={title} running className="min-w-0 text-xs" />
			) : (
				<>
					<Icon className={cn("mt-0.5 size-3.5 shrink-0", kind === "recovery" && "text-warning")} />
					<strong className="font-medium text-foreground/90">{title}</strong>
				</>
			)}
			{detail ? <span className="min-w-0 leading-relaxed">{detail}</span> : null}
		</m.div>
	);
}

function describeTurnStatus(label: string): {
	kind: TurnStatusKind;
	title: string;
	detail?: string;
} {
	const normalized = label.trim();
	const lower = normalized.toLowerCase();
	if (lower.includes("queued") || lower.includes("steered")) {
		return { kind: "queue", title: "Queued work", detail: normalized };
	}
	if (lower.includes("retry")) {
		return { kind: "retry", title: "Retrying safely", detail: normalized };
	}
	if (lower.includes("compact")) {
		return { kind: "compaction", title: "Managing context", detail: normalized };
	}
	if (lower.includes("reset") || lower.includes("recover") || lower.includes("sign in")) {
		return { kind: "recovery", title: "Run needs attention", detail: normalized };
	}
	return { kind: "notice", title: "Run update", detail: normalized };
}

function iconFor(kind: TurnStatusKind) {
	switch (kind) {
		case "queue":
			return ListRestart;
		case "retry":
			return RotateCcw;
		case "compaction":
			return Gauge;
		case "recovery":
			return AlertCircle;
		case "notice":
			return Clock3;
		default: {
			const exhaustive: never = kind;
			return exhaustive;
		}
	}
}
