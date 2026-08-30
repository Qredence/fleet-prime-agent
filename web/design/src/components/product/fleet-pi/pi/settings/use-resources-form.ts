import type { ChatPiSettings, ChatSettingsResponse } from "@prime-agent/web-protocol/chat-protocol";
import { useMemo, useState } from "react";
import {
	formatPackageSourceRows,
	harnessSettings,
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
	// null = untouched; a value = user-edited rows that must survive re-renders.
	// When untouched, rows derive directly from the settings source of truth.
	const [editedPackageRows, setEditedPackageRows] = useState<Array<string> | null>(null);
	const [packageError, setPackageError] = useState<string | undefined>();

	const derivedPackageRows = useMemo(
		() => formatPackageSourceRows(settings?.effective.packages ?? []),
		[settings?.effective.packages],
	);
	const packageRows = editedPackageRows ?? derivedPackageRows;

	const resourceDirty =
		!!draft &&
		!!settings &&
		(!sameJson(resourceSettings(draft), resourceSettings(settings.effective)) ||
			!sameJson(harnessSettings(draft), harnessSettings(settings.effective)) ||
			!sameJson(
				packageRows.filter((row) => row.trim()),
				formatPackageSourceRows(settings.effective.packages),
			));

	const handlePackageRowsChange = (rows: Array<string>) => {
		setEditedPackageRows(rows);
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
			compaction: settings.effective.compaction,
			retry: settings.effective.retry,
			transport: settings.effective.transport,
			steeringMode: settings.effective.steeringMode,
			followUpMode: settings.effective.followUpMode,
		}));
		setEditedPackageRows(null);
		setPackageError(undefined);
	};

	return {
		packageRows,
		packageError,
		resourceDirty,
		handlePackageRowsChange,
		revertResourceDraft,
	};
}
