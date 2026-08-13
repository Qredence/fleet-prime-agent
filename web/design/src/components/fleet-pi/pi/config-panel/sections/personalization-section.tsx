import { Monitor, Moon, Sun } from "lucide-react"
import { Select } from "../../../../select"
import { ItemRow } from "../../../primitives/item-row"
import type { ThemePreference } from "../../../../../lib/canvas-utils"

const THEME_OPTIONS = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
] as const

export function PersonalizationSection({
  onThemePreferenceChange,
  themePreference,
}: {
  onThemePreferenceChange: (preference: ThemePreference) => void
  themePreference: ThemePreference
}) {
  return (
    <ItemRow
      title="Theme"
      trailing={
        <Select
          aria-label="Theme"
          className="w-[160px]"
          onValueChange={(value) =>
            onThemePreferenceChange(value as ThemePreference)
          }
          options={[...THEME_OPTIONS]}
          value={themePreference}
        />
      }
    />
  )
}
