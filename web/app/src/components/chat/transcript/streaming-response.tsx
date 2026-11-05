"use client";

import { Check, Copy, ThumbsDown, ThumbsUp } from "lucide-react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { EASE_OUT, SPRING_PRESS } from "@/lib/ease";
import { cn } from "@/lib/utils";

export type StreamingResponseStatus = "streaming" | "complete";
export type StreamingResponseFeedback = "up" | "down" | null;

export interface StreamingResponseProps {
	children?: ReactNode;
	status?: StreamingResponseStatus;
	copyText?: string;
	onCopy?: () => void | Promise<void>;
	feedback?: StreamingResponseFeedback;
	defaultFeedback?: StreamingResponseFeedback;
	onFeedbackChange?: (feedback: StreamingResponseFeedback) => void;
	announce?: boolean;
	showActions?: boolean;
	className?: string;
	contentClassName?: string;
	actionsClassName?: string;
}

function ResponseAction({
	active = false,
	children,
	label,
	onClick,
}: {
	active?: boolean;
	children: ReactNode;
	label: string;
	onClick?: () => void;
}) {
	const reduce = useReducedMotion() ?? false;

	return (
		<m.button
			type="button"
			aria-label={label}
			aria-pressed={active || undefined}
			title={label}
			onClick={onClick}
			whileTap={reduce ? undefined : { scale: 0.96 }}
			transition={SPRING_PRESS}
			className={cn(
				"relative grid size-7 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
				active && "text-foreground",
			)}
		>
			{children}
		</m.button>
	);
}

export function StreamingResponse({
	children,
	status = "complete",
	copyText,
	onCopy,
	feedback,
	defaultFeedback = null,
	onFeedbackChange,
	announce = true,
	showActions = true,
	className,
	contentClassName,
	actionsClassName,
}: StreamingResponseProps) {
	const reduce = useReducedMotion() ?? false;
	const [copied, setCopied] = useState(false);
	const [internalFeedback, setInternalFeedback] = useState<StreamingResponseFeedback>(defaultFeedback);
	const copyTimer = useRef<number | undefined>(undefined);
	const currentFeedback = feedback ?? internalFeedback;
	const streaming = status === "streaming";
	const complete = status === "complete";
	const canCopy = Boolean(copyText || onCopy);
	const shouldShowActions = showActions && !streaming && (canCopy || complete);

	useEffect(
		() => () => {
			if (copyTimer.current) window.clearTimeout(copyTimer.current);
		},
		[],
	);

	const handleCopy = useCallback(async () => {
		if (onCopy) await onCopy();
		else if (copyText) await navigator.clipboard?.writeText(copyText);

		setCopied(true);
		if (copyTimer.current) window.clearTimeout(copyTimer.current);
		copyTimer.current = window.setTimeout(() => setCopied(false), 1600);
	}, [copyText, onCopy]);

	const setFeedback = (next: Exclude<StreamingResponseFeedback, null>) => {
		const value = currentFeedback === next ? null : next;
		if (feedback === undefined) setInternalFeedback(value);
		onFeedbackChange?.(value);
	};

	return (
		<div data-state={status} aria-busy={streaming} className={cn("w-full", className)}>
			<div
				aria-live={announce ? "polite" : "off"}
				className={cn(
					"text-sm leading-6 text-foreground/90 [&_a]:font-medium [&_a]:underline [&_a]:underline-offset-4 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5 [&_p+p]:mt-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5",
					contentClassName,
				)}
			>
				{children}
			</div>

			<AnimatePresence initial={false}>
				{shouldShowActions ? (
					<m.div
						initial={reduce ? { opacity: 0 } : { opacity: 0, y: 4 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0 }}
						transition={{ duration: reduce ? 0.12 : 0.22, ease: EASE_OUT }}
						className="mt-3"
					>
						<div className={cn("flex items-center gap-0.5", actionsClassName)}>
							{canCopy ? (
								<ResponseAction label={copied ? "Copied" : "Copy response"} onClick={handleCopy}>
									{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
								</ResponseAction>
							) : null}
							{complete ? (
								<>
									<ResponseAction
										label="Helpful"
										active={currentFeedback === "up"}
										onClick={() => setFeedback("up")}
									>
										<ThumbsUp className="size-3.5" />
									</ResponseAction>
									<ResponseAction
										label="Not helpful"
										active={currentFeedback === "down"}
										onClick={() => setFeedback("down")}
									>
										<ThumbsDown className="size-3.5" />
									</ResponseAction>
								</>
							) : null}
						</div>
					</m.div>
				) : null}
			</AnimatePresence>
		</div>
	);
}
