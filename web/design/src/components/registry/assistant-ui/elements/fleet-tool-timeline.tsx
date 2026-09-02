"use client"

import { ChevronDown, FilePenLine, FileSearch, Terminal, Wrench } from "lucide-react"
import { useMemo, useState } from "react"

import type { ChatMessage } from "@prime-agent/web-protocol/chat-types"
import type { PrimeAgentArtifact } from "@prime-agent/web-protocol/chat-protocol"
import { cn } from "../../../../lib/utils"

type TimelineStep = {
	id: string
	icon: typeof Terminal
	verb: string
	target: string
	status: "running" | "complete" | "error" | "cancelled"
}

type FleetToolTimelineProps = {
	messages: readonly ChatMessage[]
	artifacts?: readonly PrimeAgentArtifact[]
	streaming: boolean
	className?: string
}

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function target(input: unknown, fallback: string) {
	const source = record(input)
	for (const key of ["path", "filePath", "command", "cmd", "query", "pattern", "code"]) {
		if (typeof source?.[key] === "string" && source[key]) return source[key]
	}
	return fallback
}

function status(part: Record<string, unknown>, streaming: boolean): TimelineStep["status"] {
	const state = part.state
	if (state === "output-error" || state === "error") return "error"
	if (state === "cancelled" || state === "canceled" || state === "aborted") return "cancelled"
	if (state === "input-streaming" || state === "streaming") return streaming ? "running" : "cancelled"
	return streaming && part.output === undefined && part.result === undefined ? "running" : "complete"
}

function toolStep(part: Record<string, unknown>, fallbackId: string, streaming: boolean): TimelineStep | undefined {
	const type = part.type
	if (typeof type !== "string" || !type.startsWith("tool-") || type === "tool-FleetReasoning" || type === "tool-Thinking") return undefined
	const name = type.slice(5)
	const lower = name.toLowerCase()
	const icon = lower.includes("edit") || lower.includes("write") || lower.includes("patch")
		? FilePenLine
		: lower.includes("read") || lower.includes("search") || lower.includes("grep") || lower.includes("glob")
			? FileSearch
			: lower.includes("bash") || lower.includes("shell") || lower.includes("python") || lower.includes("ipython")
				? Terminal
				: Wrench
	const verb = lower.includes("edit") || lower.includes("write") || lower.includes("patch")
		? "Edited"
		: lower.includes("read") ? "Read" : lower.includes("search") || lower.includes("grep") || lower.includes("glob") ? "Searched" : lower.includes("bash") || lower.includes("shell") || lower.includes("python") || lower.includes("ipython") ? "Ran" : name
	return {
		id: typeof part.toolCallId === "string" ? part.toolCallId : fallbackId,
		icon,
		verb,
		target: target(part.input ?? part.args, name),
		status: status(part, streaming),
	}
}

function artifactStep(artifact: PrimeAgentArtifact): TimelineStep {
	const icon = artifact.kind === "diff" ? FilePenLine : artifact.kind === "bash" || artifact.kind === "ipython" ? Terminal : Wrench
	return {
		id: `artifact:${artifact.id}`,
		icon,
		verb: artifact.kind === "compaction" ? "Compacted" : artifact.kind === "refinement" ? "Refined" : artifact.kind === "recap" ? "Recapped" : artifact.kind === "rlm" ? "Delegated" : artifact.kind === "diff" ? "Edited" : "Completed",
		target: artifact.title,
		status: artifact.status === "success" ? "complete" : artifact.status,
	}
}

function statusClass(status: TimelineStep["status"]) {
	if (status === "running") return "text-blue-600 dark:text-blue-400"
	if (status === "error") return "text-destructive"
	if (status === "cancelled") return "text-muted-foreground"
	return "text-emerald-600 dark:text-emerald-400"
}

export function FleetToolTimeline({ messages, artifacts = [], streaming, className }: FleetToolTimelineProps) {
	const steps = useMemo(() => {
		const seen = new Set<string>()
		const fromMessages = messages.flatMap((message) =>
			message.parts.flatMap((part, index) => {
				const step = toolStep(record(part) ?? {}, `${message.id}:${index}`, streaming)
				if (!step || seen.has(step.id)) return []
				seen.add(step.id)
				return [step]
			}),
		)
		const fromArtifacts = artifacts.flatMap((artifact) => {
			if (artifact.sourceToolCallId && seen.has(artifact.sourceToolCallId)) return []
			const step = artifactStep(artifact)
			if (seen.has(step.id)) return []
			seen.add(step.id)
			return [step]
		})
		return [...fromMessages, ...fromArtifacts]
	}, [artifacts, messages, streaming])
	const [open, setOpen] = useState(true)
	if (steps.length === 0) return null

	const active = steps.at(-1)
	const ActiveIcon = active?.icon
	return (
		<section className={cn("mb-2 rounded-xl border border-border/60 bg-muted/20", className)}>
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen((current) => !current)}
				className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				{active && ActiveIcon ? <ActiveIcon className={cn("size-3.5 shrink-0", statusClass(active.status), active.status === "running" && "animate-pulse")} /> : null}
				<span className="min-w-0 flex-1 truncate font-medium">
					{streaming && active ? `${active.verb} ${active.target}` : `${steps.length} tool ${steps.length === 1 ? "action" : "actions"}`}
				</span>
				<ChevronDown className={cn("size-3.5 text-muted-foreground transition-transform", open && "rotate-180")} />
			</button>
			{open ? (
				<div className="space-y-1 border-t border-border/50 px-3 py-2">
					{steps.map((step) => {
						const Icon = step.icon
						return (
							<div key={step.id} className="flex min-w-0 items-center gap-2 text-xs">
								<Icon className={cn("size-3.5 shrink-0", statusClass(step.status))} />
								<span className="shrink-0 text-muted-foreground">{step.verb}</span>
								<span className="min-w-0 flex-1 truncate font-mono text-foreground/75">{step.target}</span>
							</div>
						)
					})}
				</div>
			) : null}
		</section>
	)
}
