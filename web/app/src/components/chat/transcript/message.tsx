"use client";

import { type HTMLMotionProps, m, useReducedMotion } from "motion/react";
import { type ComponentPropsWithRef, createContext, type ReactNode, useContext, useMemo } from "react";
import { EASE_OUT, SPRING_LAYOUT } from "@/lib/ease";
import { cn } from "@/lib/utils";

type MessageFrom = "user" | "assistant";
type MessageBubbleVariant = "solid" | "soft" | "tint" | "outline" | "ghost" | "danger";
type MessageBubbleAlign = "start" | "end";

interface MessageContextValue {
	from: MessageFrom;
}

const MessageContext = createContext<MessageContextValue>({
	from: "assistant",
});

interface MessageProps extends Omit<ComponentPropsWithRef<typeof m.article>, "children"> {
	from: MessageFrom;
	/** Plays a trailing-edge pop-up once when this message row mounts. */
	animateIn?: boolean;
	children: ReactNode;
}

type MessageContentProps = ComponentPropsWithRef<"div">;

interface MessageBubbleProps extends Omit<HTMLMotionProps<"div">, "children"> {
	variant?: MessageBubbleVariant;
	align?: MessageBubbleAlign;
	children?: ReactNode;
}

type MessageBubbleContentProps = ComponentPropsWithRef<"div">;

const MESSAGE_POP_UP = {
	type: "spring",
	stiffness: 480,
	damping: 32,
	mass: 0.62,
} as const;

const BUBBLE_CONTENT_REVEAL = {
	duration: 0.12,
	ease: EASE_OUT,
	delay: 0.04,
} as const;

export function Message({
	from,
	animateIn = false,
	children,
	className,
	initial,
	animate,
	transition,
	exit,
	style,
	...props
}: MessageProps) {
	const reduce = useReducedMotion() ?? false;
	const messageContextValue = useMemo(() => ({ from }), [from]);

	return (
		<MessageContext.Provider value={messageContextValue}>
			<m.article
				data-slot="message"
				data-from={from}
				aria-label={props["aria-label"] ?? `${from} message`}
				initial={
					initial ??
					(animateIn && !reduce
						? {
								opacity: 0,
								transform: "translateY(8px) scale(0.95)",
							}
						: false)
				}
				animate={
					animate ??
					(animateIn && !reduce
						? {
								opacity: 1,
								transform: "translateY(0px) scale(1)",
							}
						: { opacity: 1 })
				}
				exit={
					exit ??
					(reduce
						? { opacity: 0 }
						: {
								opacity: 0,
								transform: "translateY(-3px) scale(0.99)",
							})
				}
				transition={transition ?? (reduce ? { duration: 0.12 } : MESSAGE_POP_UP)}
				style={{
					transformOrigin: from === "user" ? "100% 100%" : "0% 100%",
					...style,
				}}
				className={cn(
					"group/message flex w-full items-start gap-2",
					from === "user" ? "flex-row-reverse" : "flex-row",
					className,
				)}
				{...props}
			>
				{children}
			</m.article>
		</MessageContext.Provider>
	);
}

export function MessageContent({ className, ...props }: MessageContentProps) {
	const { from } = useContext(MessageContext);

	return (
		<div
			data-slot="message-content"
			className={cn(
				"flex min-w-0 flex-1 flex-col gap-1.5",
				from === "user" ? "items-end" : "items-start",
				className,
			)}
			{...props}
		/>
	);
}

export function MessageBubble({
	variant = "ghost",
	align,
	className,
	children,
	initial,
	animate,
	exit,
	transition,
	layout,
	...props
}: MessageBubbleProps) {
	const reduce = useReducedMotion() ?? false;
	const { from } = useContext(MessageContext);
	const resolvedAlign = align ?? (from === "user" ? "end" : "start");

	return (
		<m.div
			data-slot="message-bubble"
			data-align={resolvedAlign}
			data-variant={variant}
			layout={layout}
			initial={initial ?? false}
			animate={animate}
			exit={exit ?? (reduce ? { opacity: 0 } : { opacity: 0, y: -3, scale: 0.99 })}
			transition={transition ?? (reduce ? { duration: 0.12 } : SPRING_LAYOUT)}
			className={cn(
				"group/bubble flex w-full flex-col",
				resolvedAlign === "end" ? "items-end" : "items-start",
				className,
			)}
			{...props}
		>
			{children}
		</m.div>
	);
}

export function MessageBubbleContent({ className, children, ref, ...props }: MessageBubbleContentProps) {
	const reduce = useReducedMotion() ?? false;

	return (
		<div
			ref={ref}
			data-slot="message-bubble-content"
			className={cn(
				"relative z-0 w-full max-w-none min-w-9 text-sm leading-6 text-foreground",
				"[&_a]:font-medium [&_a]:underline [&_a]:underline-offset-4 [&_code]:rounded [&_code]:bg-background/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[90%] [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p+p]:mt-2 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-background/60 [&_pre]:p-3 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5",
				className,
			)}
			{...props}
		>
			<m.div
				initial={false}
				animate={{ opacity: 1 }}
				transition={reduce ? { duration: 0.12, ease: EASE_OUT } : BUBBLE_CONTENT_REVEAL}
				className="relative"
			>
				{children}
			</m.div>
		</div>
	);
}
