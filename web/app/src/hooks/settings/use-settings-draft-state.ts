import { useContext, useEffect, useId } from "react";
import { SettingsDraftContext, type SettingsDraftStatus } from "@/lib/settings/settings-draft-context";

export function useSettingsDraftState() {
	const registry = useContext(SettingsDraftContext);
	return {
		cancelSection: registry?.cancelSection,
		dirtySections: registry?.dirtySections ?? [],
		busy: registry?.busy ?? false,
	};
}

/** Optional outside Settings, where the same forms also appear on standalone pages. */
export function useSettingsDraft(section: string, { dirty, busy }: SettingsDraftStatus) {
	const registry = useContext(SettingsDraftContext);
	const update = registry?.update;
	const key = useId();
	useEffect(() => {
		update?.(key, section, { dirty, busy });
	}, [update, key, section, dirty, busy]);
	useEffect(() => () => update?.(key, section, null), [update, key, section]);
	return registry?.resetVersions[section] ?? 0;
}
