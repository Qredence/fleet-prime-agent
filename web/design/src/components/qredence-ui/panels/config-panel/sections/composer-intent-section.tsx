import { Switch } from "@prime-agent/web-design/components/ui/switch";
import type { ComposerIntentStatus } from "@prime-agent/web-protocol/composer-intent";
import { ItemRow } from "../../../chrome/item-row";

const STATUS_COPY: Record<ComposerIntentStatus, string> = {
	unconfigured: "No TypeSafe API key is set, so this cannot be turned on.",
	unverified: "Checking the key…",
	ready: "Ready.",
	error: "The TypeSafe key could not be verified.",
};

/**
 * Settings row for composer command routing.
 *
 * States plainly that composer drafts leave the machine, because that is the
 * actual trade: a description of a command you were about to type is sent to a
 * third-party inference service to be classified.
 */
export function ComposerIntentSection({
	enabled,
	status,
	onEnabledChange,
}: {
	enabled: boolean;
	status: ComposerIntentStatus;
	onEnabledChange?: (enabled: boolean) => void;
}) {
	const unavailable = status === "unconfigured" || status === "error";
	return (
		<ItemRow
			title="Describe a command"
			subtitle={`Recognise when a message is really asking for a built-in command, like "compact this" or "show the shortcuts". Messages you send are shared with TypeSafe for classification only when this is on. ${STATUS_COPY[status]}`}
			trailing={
				<Switch
					aria-label="Describe a command"
					checked={enabled}
					disabled={unavailable}
					onCheckedChange={onEnabledChange}
				/>
			}
		/>
	);
}
