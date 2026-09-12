import { PromptInput } from "../../../registry/beui/agents/prompt-input";

/**
 * Composer for subagent tabs, built on the same prompt input as the main
 * chat bar (auto-growing editor, Enter to send, stop control). Unlike the
 * main bar it carries no model picker, slash commands, or attachments:
 * those act on the main session, while a child turn only takes message
 * text (steered). Stays pinned below the transcript so it never scrolls
 * out of view.
 */
export function SubagentComposer({
	disabled,
	sending,
	onSend,
	onStop,
	placeholder = "Message this subagent… (Enter to steer)",
}: {
	disabled?: boolean;
	sending: boolean;
	onSend: (text: string) => void;
	onStop: () => void;
	placeholder?: string;
}) {
	return (
		<div className="shrink-0 border-t border-border/60 bg-background/80 px-4 py-3 backdrop-blur">
			<div className="mx-auto w-full max-w-3xl">
				<PromptInput
					aria-label="Message subagent"
					disabled={disabled}
					loading={sending}
					minRows={1}
					onSubmit={(value) => onSend(value)}
					onStop={onStop}
					placeholder={placeholder}
				/>
			</div>
		</div>
	);
}
