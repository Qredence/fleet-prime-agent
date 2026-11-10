import {
	DASHBOARD_MODEL_SUGGESTIONS,
	type DashboardKeySource,
	type DashboardStatus,
} from "@prime-agent/web-protocol/dashboards";
import { useCallback, useEffect, useState } from "react";
import {
	fetchDashboardStatus,
	saveDashboardKey,
	saveDashboardSettings,
} from "@/components/dashboards/dashboard-client";
import { SecretCredentialField } from "@/components/settings/providers/credential-fields";
import { SettingsRow } from "@/components/settings/settings-row";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const SOURCE_COPY: Record<DashboardKeySource, string> = {
	settings: "Using the key saved here.",
	environment: "Using an API key from the server environment.",
	none: "No key is set. The assistant writes the dashboard, and Fleet draws it in the Dashboards tab.",
};

const MODE_COPY: Record<DashboardStatus["mode"], string> = {
	cloud: "OpenUI Cloud builds dashboards.",
	"self-hosted": "The assistant writes each dashboard. A key lets OpenUI Cloud build them.",
};

const MODEL_SOURCE_COPY: Record<DashboardStatus["modelSource"], string> = {
	settings: "set here",
	environment: "from FLEET_DASHBOARD_MODEL",
	default: "OpenUI's default",
};

/**
 * The key field owns only what was typed. The stored key and the environment
 * value are never sent back to the browser.
 */
export function DashboardsSection() {
	const [status, setStatus] = useState<DashboardStatus | null>(null);
	const [draftKey, setDraftKey] = useState("");
	const [draftModel, setDraftModel] = useState("");
	const [showKey, setShowKey] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let active = true;
		void fetchDashboardStatus()
			.then((next) => {
				if (!active) return;
				setStatus(next);
				setDraftModel(next.model);
			})
			.catch((cause: unknown) => {
				if (!active) return;
				setError(cause instanceof Error ? cause.message : "Could not read dashboard settings.");
			});
		return () => {
			active = false;
		};
	}, []);

	const save = useCallback(async () => {
		if (!draftKey.trim()) return;
		setBusy(true);
		setError(null);
		try {
			setStatus(await saveDashboardKey(draftKey.trim()));
			setDraftKey("");
			setShowKey(false);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Could not save the key.");
		} finally {
			setBusy(false);
		}
	}, [draftKey]);

	const clear = useCallback(async () => {
		setBusy(true);
		setError(null);
		try {
			setStatus(await saveDashboardKey(null));
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Could not remove the key.");
		} finally {
			setBusy(false);
		}
	}, []);

	/**
	 * A BYOK key only covers its own provider: an Anthropic model with an OpenAI
	 * key falls back to managed inference, which is billed separately. Saving the
	 * model alongside the key keeps the two in agreement.
	 */
	const saveModel = useCallback(async () => {
		const model = draftModel.trim();
		if (!model) return;
		setBusy(true);
		setError(null);
		try {
			setStatus(await saveDashboardSettings({ model }));
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Could not save the model.");
		} finally {
			setBusy(false);
		}
	}, [draftModel]);

	const clearModel = useCallback(async () => {
		setBusy(true);
		setError(null);
		try {
			const next = await saveDashboardSettings({ model: null });
			setStatus(next);
			setDraftModel(next.model);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Could not reset the model.");
		} finally {
			setBusy(false);
		}
	}, []);

	return (
		<div className="flex flex-col gap-3">
			<SettingsRow
				label="Dashboards"
				description={status ? `${MODE_COPY[status.mode]} ${SOURCE_COPY[status.keySource]}` : "Checking…"}
			/>
			<div className="flex flex-col gap-2 rounded-md border p-4">
				<SecretCredentialField
					attemptedSave={false}
					label="Thesys API key"
					onChange={setDraftKey}
					onToggleVisibility={() => setShowKey((current) => !current)}
					placeholder="Optional. Overrides the server environment key"
					showPassword={showKey}
					value={draftKey}
				/>
				{error ? <p className="text-xs text-destructive">{error}</p> : null}
				<div className="flex items-center gap-2">
					<Button type="button" size="compact" disabled={busy || !draftKey.trim()} onClick={() => void save()}>
						Save key
					</Button>
					{status?.keySource === "settings" ? (
						<Button type="button" variant="outline" size="compact" disabled={busy} onClick={() => void clear()}>
							Remove key
						</Button>
					) : null}
				</div>
			</div>
			<div className="flex flex-col gap-2 rounded-md border p-4">
				<div className="flex flex-col gap-1">
					<h4 className="text-sm font-medium">Dashboard builder model</h4>
					<p className="text-xs text-muted-foreground">
						OpenUI Cloud builds dashboards with this model when a Thesys key is set. It is separate from the model
						you chat with in Fleet.
					</p>
					<p className="text-xs text-muted-foreground">
						The provider part must be one you added a key for on the Thesys BYOK page. Any other provider is
						billed to Gateway managed credits instead, which fails once those are exhausted.
					</p>
				</div>
				<Input
					aria-label="Dashboard model"
					list="dashboard-model-suggestions"
					value={draftModel}
					onChange={(event) => setDraftModel(event.target.value)}
					placeholder="provider/model"
				/>
				<datalist id="dashboard-model-suggestions">
					{DASHBOARD_MODEL_SUGGESTIONS.map((model) => (
						<option key={model} value={model} />
					))}
				</datalist>
				<p className="text-xs text-muted-foreground">Use a provider-qualified id, such as openai/gpt-6-luna.</p>
				<p className="text-xs text-muted-foreground">
					{status ? `Building with ${status.model} (${MODEL_SOURCE_COPY[status.modelSource]}).` : "Checking…"}
				</p>
				<div className="flex items-center gap-2">
					<Button
						type="button"
						size="compact"
						disabled={busy || !draftModel.trim() || draftModel.trim() === status?.model}
						onClick={() => void saveModel()}
					>
						Save model
					</Button>
					{status?.modelSource === "settings" ? (
						<Button
							type="button"
							variant="outline"
							size="compact"
							disabled={busy}
							onClick={() => void clearModel()}
						>
							Use default
						</Button>
					) : null}
				</div>
			</div>
		</div>
	);
}
