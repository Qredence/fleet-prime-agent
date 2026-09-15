"use client";

import { Button } from "@prime-agent/web-design/components/ui/button";
import { SPRING_SWAP } from "@prime-agent/web-design/lib/ease";
import { cn } from "@prime-agent/web-design/lib/utils";
import { ArrowUp, Square } from "lucide-react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import {
	type FormEvent,
	type KeyboardEvent,
	type ReactNode,
	type TextareaHTMLAttributes,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

export interface PromptInputProps
	extends Omit<
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
	onKeyDown,
	...textareaProps
}: PromptInputProps) {
	const reduce = useReducedMotion() ?? false;
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const measurementRef = useRef<HTMLDivElement>(null);
	const [internalValue, setInternalValue] = useState(defaultValue);
	const currentValue = value ?? internalValue;
	const canSubmit = Boolean(currentValue.trim()) && !disabled && (!loading || submitWhileLoading);

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
		const observer = new ResizeObserver(() => resizeRef.current());
		observer.observe(textarea);
		return () => observer.disconnect();
	}, []);

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
		<form
			onSubmit={submit}
			className={cn(
				"relative w-full rounded-chat-input border border-border/70 bg-sidebar p-2 text-[color:var(--foreground)] shadow-sm transition-[border-color,box-shadow] focus-within:border-chat-input-focus-outline/45 focus-within:ring-1 focus-within:ring-chat-input-focus-outline/25",
				disabled && "opacity-60",
				className,
			)}
		>
			<div
				ref={measurementRef}
				aria-hidden="true"
				className="pointer-events-none invisible absolute inset-x-2 top-0 whitespace-pre-wrap px-2 text-sm leading-6 [overflow-wrap:break-word]"
			>
				{`${currentValue}\u200b`}
			</div>
			<textarea
				ref={textareaRef}
				value={currentValue}
				disabled={disabled}
				placeholder={placeholder}
				aria-label={ariaLabel}
				autoComplete="off"
				rows={minRows}
				{...textareaProps}
				onChange={(event) => setValue(event.target.value)}
				onKeyDown={handleKeyDown}
				className="scrollbar-hide block w-full resize-none overflow-y-auto bg-transparent px-2 pt-1.5 text-sm leading-6 text-foreground outline-none placeholder:text-foreground/55"
			/>

			<div className="mt-1 flex min-h-8 items-center gap-1">
				{leadingAction}

				{loading && onStop ? (
					<Button
						type="button"
						size="icon"
						aria-label="Stop generating"
						onClick={onStop}
						className="ml-auto size-8 rounded-full"
					>
						<Square className="size-3 fill-current" />
					</Button>
				) : null}
				{!loading || canSubmit ? (
					<Button
						type="submit"
						size="icon"
						disabled={!canSubmit}
						aria-label={loading ? "Steer current run" : "Send prompt"}
						className={cn(
							"size-8 rounded-full",
							!loading && "ml-auto",
							canSubmit &&
								"border-transparent bg-chat-input-accent text-white hover:bg-chat-input-accent/90 focus-visible:border-chat-input-accent focus-visible:ring-chat-input-accent/40",
						)}
					>
						<AnimatePresence initial={false} mode="popLayout">
							<m.span
								key="send"
								initial={reduce ? { opacity: 1 } : { opacity: 0, y: 3, scale: 0.8 }}
								animate={{ opacity: 1, y: 0, scale: 1 }}
								exit={reduce ? { opacity: 0 } : { opacity: 0, y: -3, scale: 0.8 }}
								transition={reduce ? { duration: 0 } : SPRING_SWAP}
								className="grid place-items-center"
							>
								<ArrowUp className="size-4" />
							</m.span>
						</AnimatePresence>
					</Button>
				) : null}
			</div>
		</form>
	);
}
