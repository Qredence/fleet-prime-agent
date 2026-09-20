import type { ComposerIntentKeySource, ComposerIntentStatus } from "@prime-agent/web-protocol/composer-intent";
import { useCallback, useState } from "react";
import { ItemRow } from "@/components/layout/item-row";
import { SecretCredentialField } from "@/components/settings/providers/credential-fields";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

const STATUS_COPY: Record<ComposerIntentStatus, string> = {
	unconfigured: "Add a key below to turn this on.",
	unverified: "Checking the key…",
	ready: "Ready.",
	error: "The TypeSafe key could not be verified.",
};

/** Which key is in effect. Never the key itself — it is write-only. */
const KEY_SOURCE_COPY: Record<ComposerIntentKeySource, string> = {
	settings: "Using the key saved here.",
	environment: "Using TYPESAFE_API_KEY from the server environment.",
	none: "No key is set.",
};

/**
 * Settings section for composer command routing and its API key.
 *
 * States plainly that composer drafts leave the machine, because that is the
 * actual trade: a description of a command you were about to type is sent to a
 * third-party inference service to be classified.
 *
 * The key field owns only what has been typed into it. The stored key itself is
 * never sent back to the browser, so there is nothing to prefill and the field
 * always starts empty.
 */
export function ComposerIntentSection({
	enabled,
	keySource,
	status,
	onClearKey,
	onEnabledChange,
	onSaveKey,
}: {
	enabled: boolean;
	keySource: ComposerIntentKeySource;
	status: ComposerIntentStatus;
	onClearKey?: () => Promise<void> | void;
	onEnabledChange?: (enabled: boolean) => void;
	onSaveKey?: (apiKey: string) => Promise<void> | void;
}) {
	const [draftKey, setDraftKey] = useState("");
	const [showKey, setShowKey] = useState(false);
	const [attemptedSave, setAttemptedSave] = useState(false);
	const [busy, setBusy] = useState(false);

	const save = useCallback(async () => {
		setAttemptedSave(true);
		if (!draftKey.trim() || !onSaveKey) return;
		setBusy(true);
		try {
			await onSaveKey(draftKey.trim());
			// The value is never echoed back, so clearing the field is the only
			// confirmation available — the source line below carries the outcome.
			setDraftKey("");
			setShowKey(false);
			setAttemptedSave(false);
		} finally {
			setBusy(false);
		}
	}, [draftKey, onSaveKey]);

	const clear = useCallback(async () => {
		if (!onClearKey) return;
		setBusy(true);
		try {
			await onClearKey();
			setDraftKey("");
		} finally {
			setBusy(false);
		}
	}, [onClearKey]);

	const unavailable = status === "unconfigured" || status === "error";

	return (
		<div className="flex flex-col gap-3">
			<ItemRow
				title="Describe a command"
				subtitle={`Recognise when a message is really asking for a built-in command, like "compact this" or "show the shortcuts". Messages you send are shared with TypeSafe for classification only when this is on. ${STATUS_COPY[status]}`}
				trailing={
					<Switch
						aria-label="Describe a command"
						checked={enabled}
						// Disabled only when it cannot be turned *on*. An already-enabled
						// setting stays switchable while the key is missing or broken, or
						// the user would be stuck with it on until they fixed the key.
						disabled={!onEnabledChange || (!enabled && unavailable)}
						onCheckedChange={onEnabledChange}
					/>
				}
			/>
			<div className="flex flex-col gap-2 rounded-xl border p-4">
				<SecretCredentialField
					attemptedSave={attemptedSave}
					label="TypeSafe API key"
					onChange={setDraftKey}
					onToggleVisibility={() => setShowKey((current) => !current)}
					placeholder="Paste your TypeSafe API key"
					showPassword={showKey}
					value={draftKey}
				/>
				<p className="text-xs text-muted-foreground">{KEY_SOURCE_COPY[keySource]}</p>
				<div className="flex items-center gap-2">
					<Button type="button" size="sm" disabled={busy || !draftKey.trim()} onClick={() => void save()}>
						Save key
					</Button>
					{keySource === "settings" ? (
						<Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void clear()}>
							Remove key
						</Button>
					) : null}
				</div>
			</div>
		</div>
	);
}
