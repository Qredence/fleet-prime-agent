"use client";

import { Check, ChevronDown, CircleAlert, LoaderCircle, ShieldCheck, X } from "lucide-react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { EASE_OUT, SPRING_SWAP } from "@/lib/ease";
import { cn } from "@/lib/utils";

export type ToolApprovalStatus = "pending" | "approving" | "approved" | "denied" | "running" | "complete" | "error";

export interface ToolApprovalParameter {
	id: string;
	label: ReactNode;
	value: ReactNode;
}

export interface ToolApprovalProps {
	tool: ReactNode;
	title?: ReactNode;
	description?: ReactNode;
	parameters?: ToolApprovalParameter[];
	status?: ToolApprovalStatus;
	open?: boolean;
	defaultOpen?: boolean;
	onOpenChange?: (open: boolean) => void;
	onApprove?: () => void;
	onAlwaysAllow?: () => void;
	onDeny?: () => void;
	className?: string;
}

function getStatusCopy(status: ToolApprovalStatus) {
	if (status === "approving") return "Approving";
	if (status === "approved") return "Approved";
	if (status === "denied") return "Denied";
	if (status === "running") return "Running";
	if (status === "complete") return "Completed";
	if (status === "error") return "Failed";
	return "Approval required";
}

function getStatusBadgeClass(status: ToolApprovalStatus) {
	if (status === "pending") {
		return "border-warning/30 bg-warning/10 text-warning";
	}
	if (status === "approving" || status === "running") {
		return "border-primary/30 bg-primary/10 text-primary";
	}
	if (status === "approved" || status === "complete") {
		return "border-success/30 bg-success/10 text-success";
	}
	return "border-destructive/30 bg-destructive/10 text-destructive";
}

export function ToolApproval({
	tool,
	title = "Allow this tool to run?",
	description,
	parameters = [],
	status = "pending",
	open,
	defaultOpen = false,
	onOpenChange,
	onApprove,
	onAlwaysAllow,
	onDeny,
	className,
}: ToolApprovalProps) {
	const reduce = useReducedMotion() ?? false;
	const baseId = useId();
	const detailsId = `${baseId}-details`;
	const previousStatus = useRef(status);
	const [internalOpen, setInternalOpen] = useState(defaultOpen);
	const currentOpen = open ?? internalOpen;
	const setOpen = useCallback(
		(next: boolean) => {
			if (open === undefined) setInternalOpen(next);
			onOpenChange?.(next);
		},
		[onOpenChange, open],
	);
	const busy = status === "approving" || status === "running";
	const pending = status === "pending";
	const error = status === "error";

	useEffect(() => {
		if (previousStatus.current === "pending" && status !== "pending") {
			setOpen(false);
		}
		previousStatus.current = status;
	}, [setOpen, status]);

	return (
		<Item
			variant="outline"
			size="sm"
			data-state={status}
			aria-busy={busy}
			className={cn("items-start rounded-2xl bg-muted/20 p-4", className)}
		>
			<ItemMedia
				aria-hidden="true"
				className={cn(
					"mt-0.5 grid size-8 place-items-center rounded-xl border border-border/60 bg-background text-muted-foreground",
					error && "text-destructive",
				)}
			>
				{busy ? (
					<LoaderCircle className={cn("size-4", !reduce && "animate-spin")} />
				) : error ? (
					<CircleAlert className="size-4" />
				) : status === "denied" ? (
					<X className="size-4" />
				) : status === "approved" || status === "complete" ? (
					<Check className="size-4" />
				) : (
					<ShieldCheck className="size-4" />
				)}
			</ItemMedia>

			<ItemContent>
				<div className="flex min-w-0 items-start justify-between gap-3">
					<div className="min-w-0">
						<ItemTitle className="text-foreground">{title}</ItemTitle>
						<div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{tool}</div>
					</div>
					<span
						className={cn(
							"shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors",
							getStatusBadgeClass(status),
						)}
					>
						{getStatusCopy(status)}
					</span>
				</div>
				{description ? <ItemDescription className="mt-1 leading-5">{description}</ItemDescription> : null}

				{parameters.length ? (
					<Collapsible open={currentOpen} onOpenChange={setOpen}>
						<CollapsibleTrigger
							render={
								<Button
									type="button"
									variant="ghost"
									size="compact"
									className="mt-2 h-auto gap-1 px-0 py-0.5 text-xs font-medium text-muted-foreground hover:bg-transparent hover:text-foreground"
								/>
							}
						>
							View details
							<m.span
								aria-hidden="true"
								animate={{ rotate: currentOpen ? 180 : 0 }}
								transition={reduce ? { duration: 0 } : SPRING_SWAP}
							>
								<ChevronDown className="size-3.5" />
							</m.span>
						</CollapsibleTrigger>
						<CollapsibleContent id={detailsId} keepMounted className="overflow-hidden">
							<dl className="mt-3 grid gap-2 rounded-xl border border-border/50 bg-background/70 p-3">
								{parameters.map((parameter) => (
									<div
										key={parameter.id}
										className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] items-center gap-3 text-xs"
									>
										<dt className="text-muted-foreground">{parameter.label}</dt>
										<dd className="min-w-0 break-words font-mono text-foreground/85">{parameter.value}</dd>
									</div>
								))}
							</dl>
						</CollapsibleContent>
					</Collapsible>
				) : null}

				<AnimatePresence initial={false}>
					{pending ? (
						<m.div
							initial={reduce ? { opacity: 0 } : { opacity: 0, y: 4 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0 }}
							transition={{ duration: reduce ? 0.12 : 0.22, ease: EASE_OUT }}
							className="mt-2"
						>
							<ItemActions className="flex-wrap">
								<Button
									type="button"
									variant="primary"
									size="compact"
									onClick={onApprove}
									className="rounded-xl enabled:active:scale-[0.96]"
								>
									Allow once
								</Button>
								{onAlwaysAllow ? (
									<Button
										type="button"
										variant="outline"
										size="compact"
										onClick={onAlwaysAllow}
										className="rounded-xl enabled:active:scale-[0.96]"
									>
										Always allow
									</Button>
								) : null}
								<Button type="button" variant="ghost" size="compact" onClick={onDeny} className="rounded-xl">
									Deny
								</Button>
							</ItemActions>
						</m.div>
					) : null}
				</AnimatePresence>
			</ItemContent>
		</Item>
	);
}
