"use client";

import { MessageSideContext } from "@prime-agent/web-design/components/qredence-ui/chat/message/message-context";
import { cn } from "@prime-agent/web-design/lib/utils";
import { m, useReducedMotion } from "motion/react";
import { type ComponentPropsWithRef, createContext, type ReactNode, useContext, useMemo } from "react";

export {
	MessageBubble,
	MessageBubbleCollapsible,
	MessageBubbleContent,
	MessageBubbleGroup,
} from "@prime-agent/web-design/components/qredence-ui/chat/message/message-bubble";
export type { MessageScrollerProps } from "@prime-agent/web-design/components/qredence-ui/chat/message/message-scroller";
export { MessageScroller } from "@prime-agent/web-design/components/qredence-ui/chat/message/message-scroller";

export type MessageFrom = "user" | "assistant";

interface MessageContextValue {
	from: MessageFrom;
}

const MessageContext = createContext<MessageContextValue>({
	from: "assistant",
});

export interface MessageProps extends Omit<ComponentPropsWithRef<typeof m.article>, "children"> {
	from: MessageFrom;
	/** Plays a trailing-edge pop-up once when this message row mounts. */
	animateIn?: boolean;
	children: ReactNode;
}

export type MessageContentProps = ComponentPropsWithRef<"div">;

// A sent row should rise from the live edge without changing measured layout.
const MESSAGE_POP_UP = {
	type: "spring",
	stiffness: 480,
	damping: 32,
	mass: 0.62,
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
		<MessageSideContext.Provider value={from === "user" ? "end" : "start"}>
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
		</MessageSideContext.Provider>
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
