import { type ReactNode, useCallback, useMemo, useState } from "react";
import { SettingsDraftContext, type SettingsDraftStatus } from "@/lib/settings/settings-draft-context";

/** Tracks metadata only. Credential drafts remain in their owning mounted form. */
export function SettingsDraftProvider({ children }: { children: ReactNode }) {
	const [resetVersions, setResetVersions] = useState<Record<string, number>>({});
	const cancelSection = useCallback(
		(section: string) => setResetVersions((current) => ({ ...current, [section]: (current[section] ?? 0) + 1 })),
		[],
	);
	const [entries, setEntries] = useState<Record<string, SettingsDraftStatus & { section: string }>>({});
	const update = useCallback((key: string, section: string, status: SettingsDraftStatus | null) => {
		setEntries((current) => {
			const previous = current[key];
			if (!status) {
				if (!previous) return current;
				const next = { ...current };
				delete next[key];
				return next;
			}
			if (previous?.section === section && previous.dirty === status.dirty && previous.busy === status.busy)
				return current;
			return { ...current, [key]: { ...status, section } };
		});
	}, []);
	const value = useMemo(
		() => ({
			resetVersions,
			cancelSection,
			update,
			dirtySections: [
				...new Set(
					Object.values(entries)
						.filter((entry) => entry.dirty)
						.map((entry) => entry.section),
				),
			],
			busy: Object.values(entries).some((entry) => entry.busy),
		}),
		[entries, update, resetVersions, cancelSection],
	);
	return <SettingsDraftContext value={value}>{children}</SettingsDraftContext>;
}
