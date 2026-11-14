"use client";

import { ArrowUp, Square } from "lucide-react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import {
	type FormEvent,
	type KeyboardEvent,
	type ReactNode,
	type TextareaHTMLAttributes,
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { PROMPT_GHOST_CLASS, PROMPT_GHOST_PREFIX_CLASS, PROMPT_TEXT_METRICS } from "@/hooks/chat/inline-completion";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { SPRING_SWAP } from "@/lib/ease";
import { cn } from "@/lib/utils";

export interface PromptInputProps extends Omit<
	TextareaHTMLAttributes<HTMLTextAreaElement>,
	"value" | "defaultValue" | "onChange" | "onSubmit" | "children"
> {
	value?: string;
	defaultValue?: string;
	onValueChange?: (value: string) => void;
	onSubmit?: (value: string) => void | Promise<void>;
	loading?: boolean;
	/** Keep prompt submission available while loading; Stop remains a separate action. */
	submitWhileLoading?: boolean;
	onStop?: () => void;
	minRows?: number;
	maxRows?: number;
	leadingAction?: ReactNode;
	className?: string;
	/**
	 * Ghost text painted after the caret, already decided by the host. This
	 * component only paints it: whether a completion should be shown depends on
	 * live editing state supplied by the host.
	 */
	ghostText?: string;
	/** Lets the host read the textarea's caret without a `getElementById` lookup. */
	onTextareaRef?: (element: HTMLTextAreaElement | null) => void;
}

export function PromptInput({
	value,
	defaultValue = "",
	onValueChange,
	onSubmit,
	loading = false,
	submitWhileLoading = false,
	onStop,
	minRows = 2,
	maxRows = 8,
	leadingAction,
	className,
	disabled,
	placeholder = "Ask the agent to do something…",
	"aria-label": ariaLabel = "Prompt",
	"aria-describedby": ariaDescribedBy,
	onKeyDown,
	onScroll,
	ghostText,
	onTextareaRef,
	...textareaProps
}: PromptInputProps) {
	const reduce = useReducedMotion() ?? false;
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const measurementRef = useRef<HTMLDivElement>(null);
	const ghostMirrorRef = useRef<HTMLDivElement>(null);
	const descriptionId = useId();
	const ghostStatusId = useId();
	const [mirrorWidth, setMirrorWidth] = useState<number | undefined>(undefined);
	const [internalValue, setInternalValue] = useState(defaultValue);
	const currentValue = value ?? internalValue;
	const canSubmit = Boolean(currentValue.trim()) && !disabled && (!loading || submitWhileLoading);
	const sendDisabled = Boolean(disabled) || (loading && !submitWhileLoading);
	const describedBy = [descriptionId, ghostStatusId, ariaDescribedBy].filter(Boolean).join(" ");

	/**
	 * Keeps the ghost mirror aligned with the textarea.
	 *
	 * The width pin matters: `scrollbar-hide` is not a real utility in this
	 * project, so once the draft overflows the visible rows the textarea's
	 * content box is narrower than its border box. Without pinning to
	 * `clientWidth` the mirror wraps at a different column than the textarea.
	 */
	const syncGhostLayer = useCallback(() => {
		const textarea = textareaRef.current;
		const mirror = ghostMirrorRef.current;
		if (!mirror) return;
		if (textarea) {
			mirror.scrollTop = textarea.scrollTop;
			setMirrorWidth((current) => (current === textarea.clientWidth ? current : textarea.clientWidth));
		}
	}, []);

	useLayoutEffect(() => {
		syncGhostLayer();
	}, [syncGhostLayer, ghostText, currentValue]);

	const resizeTextarea = useCallback(() => {
		const textarea = textareaRef.current;
		const measurement = measurementRef.current;
		if (!textarea || !measurement || textarea.value !== currentValue) return;

		const lineHeight = 24;
		const nextHeight = Math.min(Math.max(measurement.scrollHeight, minRows * lineHeight), maxRows * lineHeight);
		const height = `${nextHeight}px`;
		if (textarea.style.height !== height) textarea.style.height = height;
	}, [currentValue, maxRows, minRows]);

	useLayoutEffect(() => {
		resizeTextarea();
	}, [resizeTextarea]);

	const resizeRef = useRef(resizeTextarea);
	useEffect(() => {
		resizeRef.current = resizeTextarea;
	});

	useEffect(() => {
		const textarea = textareaRef.current;
		if (!textarea || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(() => {
			resizeRef.current();
			// Content-box changes are exactly when the mirror can drift.
			syncGhostLayer();
		});
		observer.observe(textarea);
		return () => observer.disconnect();
	}, [syncGhostLayer]);

	// Publish the element so the host can read the caret without a DOM lookup.
	useEffect(() => {
		onTextareaRef?.(textareaRef.current);
		return () => onTextareaRef?.(null);
	}, [onTextareaRef]);

	const setValue = (next: string) => {
		if (value === undefined) setInternalValue(next);
		onValueChange?.(next);
	};

	const submit = (event?: FormEvent) => {
		event?.preventDefault();
		const prompt = currentValue.trim();
		if (!prompt || disabled || (loading && !submitWhileLoading)) return;

		onSubmit?.(prompt);
		if (value === undefined) setInternalValue("");
		textareaRef.current?.focus({ preventScroll: true });
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		onKeyDown?.(event);
		if (event.defaultPrevented || event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
			return;
		}
		event.preventDefault();
		submit();
	};

	return (
		<form aria-label="Message composer" onSubmit={submit} className="w-full rounded-chat-input">
			<InputGroup
				className={cn(
					"relative h-auto w-full flex-col rounded-chat-input border border-border/70 bg-sidebar p-2 dark:bg-sidebar has-disabled:bg-sidebar has-disabled:opacity-100 dark:has-disabled:bg-sidebar text-[color:var(--foreground)] shadow-sm transition-[border-color,box-shadow] focus-within:border-chat-input-focus-outline/45 focus-within:ring-2 focus-within:ring-chat-input-focus-outline/25 has-[[data-slot=input-group-control]:focus-visible]:border-chat-input-focus-outline/45 has-[[data-slot=input-group-control]:focus-visible]:ring-2 has-[[data-slot=input-group-control]:focus-visible]:ring-chat-input-focus-outline/25",
					disabled && "has-disabled:opacity-60",
					className,
				)}
			>
				<div
					ref={measurementRef}
					data-slot="composer-measure"
					aria-hidden="true"
					className={cn("pointer-events-none invisible absolute inset-x-2 top-0", PROMPT_TEXT_METRICS)}
				>
					{`${currentValue}\u200b`}
				</div>
				<p id={descriptionId} className="sr-only">
					Enter to send. Shift+Enter for a new line. Tab accepts an inline suggestion or menu item. Escape
					dismisses suggestions.
				</p>
				<p id={ghostStatusId} className="sr-only" aria-live="polite">
					{ghostText ? "Suggestion available. Press Tab to accept." : ""}
				</p>
				<div className="relative w-full">
					{/* Ghost layer. A sibling of the measurement div, never a child: the
				    measurement drives the composer's height, so ghost text there would
				    grow the box while typing. Absolutely positioned over the textarea's
				    border box so it needs no arithmetic against the form's padding. */}
					{ghostText ? (
						<div
							data-slot="composer-ghost-layer"
							aria-hidden="true"
							className="pointer-events-none absolute inset-0 select-none overflow-hidden"
						>
							<div
								ref={ghostMirrorRef}
								data-slot="composer-ghost-mirror"
								className={cn("h-full overflow-hidden pt-1.5", PROMPT_TEXT_METRICS, PROMPT_GHOST_PREFIX_CLASS)}
								style={mirrorWidth === undefined ? undefined : { width: `${mirrorWidth}px` }}
							>
								{currentValue}
								<span data-slot="composer-ghost" className={PROMPT_GHOST_CLASS}>
									{ghostText}
								</span>
							</div>
						</div>
					) : null}
					<InputGroupTextarea
						ref={textareaRef}
						value={currentValue}
						disabled={disabled}
						placeholder={placeholder}
						aria-label={ariaLabel}
						aria-describedby={describedBy}
						autoComplete="off"
						rows={minRows}
						{...textareaProps}
						onChange={(event) => setValue(event.target.value)}
						onKeyDown={handleKeyDown}
						onScroll={(event) => {
							onScroll?.(event);
							syncGhostLayer();
						}}
						className={cn(
							"block min-h-0 w-full field-sizing-fixed resize-none overflow-y-auto rounded-none border-0 bg-transparent px-2 py-0 pt-1.5 text-foreground outline-none placeholder:text-foreground/70 disabled:opacity-100",
							PROMPT_TEXT_METRICS,
						)}
					/>
				</div>

				<InputGroupAddon align="block-end" className="mt-1 min-h-8 gap-1.5 px-0 py-0 font-normal">
					{leadingAction ? (
						<div role="group" aria-label="Composer options" className="flex min-w-0 items-center gap-1.5">
							{leadingAction}
						</div>
					) : null}

					{/* One always-mounted animation root: Stop while a turn is running,
				    Send otherwise (and alongside Stop when follow-ups are allowed).
				    Hoisting `AnimatePresence` out of the conditional buttons keeps it
				    mounted for the lifetime of each child, so an exiting action can
				    finish animating instead of being torn down with its parent. */}
					<AnimatePresence initial={false} mode="popLayout">
						{loading && onStop ? (
							<m.div
								key="stop"
								initial={reduce ? { opacity: 1 } : { opacity: 0, y: 3, scale: 0.8 }}
								animate={{ opacity: 1, y: 0, scale: 1 }}
								exit={reduce ? { opacity: 0 } : { opacity: 0, y: -3, scale: 0.8 }}
								transition={reduce ? { duration: 0 } : SPRING_SWAP}
								className={cn(loading && canSubmit ? undefined : "ms-auto")}
							>
								<InputGroupButton
									variant="primary"
									type="button"
									size="icon-sm"
									aria-label="Stop generating"
									onClick={onStop}
									className="size-8 rounded-full"
								>
									<Square aria-hidden="true" className="size-3 fill-current" />
								</InputGroupButton>
							</m.div>
						) : null}
						{!loading || canSubmit || submitWhileLoading ? (
							<m.div
								key="send"
								initial={reduce ? { opacity: 1 } : { opacity: 0, y: 3, scale: 0.8 }}
								animate={{ opacity: 1, y: 0, scale: 1 }}
								exit={reduce ? { opacity: 0 } : { opacity: 0, y: -3, scale: 0.8 }}
								transition={reduce ? { duration: 0 } : SPRING_SWAP}
								className={cn(!loading && "ms-auto")}
							>
								<InputGroupButton
									variant="primary"
									type="submit"
									size="icon-sm"
									disabled={sendDisabled || !currentValue.trim()}
									aria-label={loading ? "Send follow-up" : "Send prompt"}
									className="size-8 rounded-full"
								>
									<ArrowUp aria-hidden="true" className="size-4" />
								</InputGroupButton>
							</m.div>
						) : null}
					</AnimatePresence>
				</InputGroupAddon>
			</InputGroup>
		</form>
	);
}
