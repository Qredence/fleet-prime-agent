import type { ChatDeliveryMode, ChatPiSettings, ChatTransport } from "@prime-agent/web-protocol/chat-protocol";
import { FieldGroup, Field, FieldLabel, FieldDescription } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { SettingsRow } from "@/components/settings/settings-row";

export function HarnessRuntimeSection({
	draft,
	updateDraft,
	section = "all",
}: {
	draft: ChatPiSettings | null;
	updateDraft: (updater: (current: ChatPiSettings) => ChatPiSettings) => void;
	section?: "all" | "context" | "retry-delivery" | "transport";
}) {
	const disabled = !draft;
	return (
		<FieldGroup>
			{section === "context" || section === "all" ? (
				<>
					<SettingsRow label="Compaction" description="Summarize earlier turns when the context fills up.">
						<Switch
							aria-label="Compaction"
							disabled={disabled}
							checked={draft?.compaction.enabled ?? false}
							onCheckedChange={(enabled) =>
								updateDraft((current) => ({ ...current, compaction: { ...current.compaction, enabled } }))
							}
						/>
					</SettingsRow>
					{(
						[
							["reserveTokens", "Reserved context tokens"],
							["keepRecentTokens", "Recent context tokens"],
						] as const
					).map(([key, label]) => (
						<Field key={key}>
							<FieldLabel>{label}</FieldLabel>
							<Input
								aria-label={label}
								type="number"
								min={1}
								disabled={disabled}
								value={draft?.compaction[key] ?? ""}
								onChange={(event) => {
									const value = event.target.valueAsNumber;
									if (Number.isInteger(value) && value > 0)
										updateDraft((current) => ({
											...current,
											compaction: { ...current.compaction, [key]: value },
										}));
								}}
							/>
							<FieldDescription>Positive number of tokens.</FieldDescription>
						</Field>
					))}
				</>
			) : null}
			{section === "retry-delivery" || section === "all" ? (
				<>
					<SettingsRow label="Auto-retry" description="Retry failed provider requests.">
						<Switch
							aria-label="Auto-retry"
							disabled={disabled}
							checked={draft?.retry.enabled ?? false}
							onCheckedChange={(enabled) =>
								updateDraft((current) => ({ ...current, retry: { ...current.retry, enabled } }))
							}
						/>
					</SettingsRow>
					{(
						[
							["maxRetries", "Maximum retries"],
							["baseDelayMs", "Retry delay (milliseconds)"],
						] as const
					).map(([key, label]) => (
						<Field key={key}>
							<FieldLabel>{label}</FieldLabel>
							<Input
								aria-label={label}
								type="number"
								min={0}
								disabled={disabled}
								value={draft?.retry[key] ?? ""}
								onChange={(event) => {
									const value = event.target.valueAsNumber;
									if (Number.isInteger(value) && value >= 0)
										updateDraft((current) => ({ ...current, retry: { ...current.retry, [key]: value } }));
								}}
							/>
						</Field>
					))}
					{(
						[
							["steeringMode", "Steering", "How queued instructions are delivered during a turn."],
							["followUpMode", "Follow-up", "How queued follow-ups run after a turn."],
						] as const
					).map(([key, label, description]) => (
						<SettingsRow key={key} label={label} description={description}>
							<Select
								aria-label={label}
								disabled={disabled}
								value={draft?.[key] ?? "one-at-a-time"}
								options={[
									{ value: "all", label: "All" },
									{ value: "one-at-a-time", label: "One at a time" },
								]}
								onValueChange={(value) =>
									updateDraft((current) => ({ ...current, [key]: value as ChatDeliveryMode }))
								}
							/>
						</SettingsRow>
					))}
				</>
			) : null}
			{section === "transport" || section === "all" ? (
				<SettingsRow
					label="Provider inference transport"
					description="Transport used for provider requests, separate from Fleet’s browser connection."
				>
					<Select
						aria-label="Provider inference transport"
						disabled={disabled}
						value={draft?.transport ?? "auto"}
						options={[
							{ value: "auto", label: "Auto" },
							{ value: "sse", label: "SSE" },
							{ value: "websocket", label: "WebSocket" },
						]}
						onValueChange={(value) =>
							updateDraft((current) => ({ ...current, transport: value as ChatTransport }))
						}
					/>
				</SettingsRow>
			) : null}
		</FieldGroup>
	);
}
