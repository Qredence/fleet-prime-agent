import { Monitor, Moon, Sun } from "lucide-react";
import type { ThemePreference } from "../../../../../../lib/canvas-utils";
import { Field, FieldDescription, FieldLabel } from "../../../../../ui/field";
import { Select } from "../../../../../ui/select";

const THEME_OPTIONS = [
	{ value: "system", label: "System", icon: Monitor },
	{ value: "light", label: "Light", icon: Sun },
	{ value: "dark", label: "Dark", icon: Moon },
] as const;

export function PersonalizationSection({
	onThemePreferenceChange,
	themePreference,
}: {
	onThemePreferenceChange: (preference: ThemePreference) => void;
	themePreference: ThemePreference;
}) {
	return (
		<Field orientation="horizontal" className="items-center justify-between gap-6 rounded-xl border p-4">
			<div className="min-w-0">
				<FieldLabel>Theme</FieldLabel>
				<FieldDescription>Match the system theme or pick light or dark.</FieldDescription>
			</div>
			<div className="shrink-0">
				<Select
					aria-label="Theme"
					className="w-[160px]"
					onValueChange={(value) => onThemePreferenceChange(value as ThemePreference)}
					options={[...THEME_OPTIONS]}
					value={themePreference}
				/>
			</div>
		</Field>
	);
}
