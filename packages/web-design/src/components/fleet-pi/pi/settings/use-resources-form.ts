import type { ChatPiSettings, ChatSettingsResponse } from "@prime-agent/web-protocol/chat-protocol";
import { useEffect, useState } from "react";
import {
	formatPackageSourceRows,
	parsePackageSourceRows,
	resourceSettings,
	sameJson,
} from "../config-panel/shared/settings-mappers";

/**
 * Owns the resource-editing slice of the settings form: package source rows,
 * parse errors, resource dirty detection, and the resources revert.
 */
export function useResourcesForm({
	draft,
	settings,
	updateDraft,
}: {
	draft: ChatPiSettings | null;
	settings: ChatSettingsResponse | null;
	updateDraft: (updater: (current: ChatPiSettings) => ChatPiSettings) => void;
}) {
	const [packageRows, setPackageRows] = useState<Array<string>>([]);
	const [packageError, setPackageError] = useState<string | undefined>();

	const resourceDirty =
		!!draft &&
		!!settings &&
		(!sameJson(resourceSettings(draft), resourceSettings(settings.effective)) ||
			!sameJson(
				packageRows.filter((row) => row.trim()),
				formatPackageSourceRows(settings.effective.packages),
			));

	const handlePackageRowsChange = (rows: Array<string>) => {
		setPackageRows(rows);
		try {
			const packages = parsePackageSourceRows(rows);
			setPackageError(undefined);
			updateDraft((current) => ({ ...current, packages }));
		} catch (error) {
			setPackageError(error instanceof Error ? error.message : String(error));
		}
	};

	const revertResourceDraft = () => {
		if (!settings) return;
		updateDraft((current) => ({
			...current,
			packages: settings.effective.packages,
			extensions: settings.effective.extensions,
			skills: settings.effective.skills,
			prompts: settings.effective.prompts,
			themes: settings.effective.themes,
			enableSkillCommands: settings.effective.enableSkillCommands,
		}));
		setPackageRows(formatPackageSourceRows(settings.effective.packages));
		setPackageError(undefined);
	};

	// Reconcile package rows with the settings source-of-truth whenever it is
	// NOT carrying user edits. The dialog still owns the draft; this hook owns
	// the derived rows/error so callers don't orchestrate raw setters.
	useEffect(() => {
		if (!settings) return;
		if (resourceDirty) return;

		const nextPackageRows = formatPackageSourceRows(settings.effective.packages);
		if (sameJson(packageRows, nextPackageRows) && packageError === undefined) {
			return;
		}
		setPackageRows(nextPackageRows);
		setPackageError(undefined);
	}, [packageError, packageRows, resourceDirty, settings]);

	return {
		packageRows,
		packageError,
		resourceDirty,
		handlePackageRowsChange,
		revertResourceDraft,
	};
}
