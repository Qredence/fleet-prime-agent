import assert from "node:assert/strict"

import {
  RIGHT_PANEL_DEFINITIONS,
  RIGHT_PANEL_REGISTRY,
} from "../src/components/product/fleet-pi/layout/right-panel-registry"
import {
  SETTINGS_SECTIONS,
  SETTINGS_SECTION_REGISTRY,
  isSettingsSectionId,
} from "../src/components/product/fleet-pi/pi/settings-sections"

assert.deepEqual(
  RIGHT_PANEL_DEFINITIONS.map(({ id }) => id),
  ["resources", "workspace", "artifacts", "repl", "subagents", "session-insights"],
)
assert.equal(new Set(RIGHT_PANEL_DEFINITIONS.map(({ order }) => order)).size, RIGHT_PANEL_DEFINITIONS.length)
for (const definition of RIGHT_PANEL_DEFINITIONS) {
  assert.equal(RIGHT_PANEL_REGISTRY[definition.id], definition)
  assert.ok(definition.title && definition.ariaLabel && definition.commandLabel)
  assert.ok(definition.commandKeywords.length > 0)
  assert.ok(definition.dataTestid && definition.mobileDataTestid)
  assert.equal(typeof definition.component, "function")
}
assert.equal(RIGHT_PANEL_REGISTRY.resources.badgeSource, "resources")
assert.equal(RIGHT_PANEL_REGISTRY.artifacts.badgeSource, "artifacts")
assert.equal(RIGHT_PANEL_REGISTRY.workspace.refreshSource, "workspace")

assert.deepEqual(
  SETTINGS_SECTIONS.map(({ id }) => id),
  ["appearance", "chat", "sandbox", "providers", "llm-models", "skills", "pi-harness", "keybindings", "sessions"],
)
assert.equal(new Set(SETTINGS_SECTIONS.map(({ order }) => order)).size, SETTINGS_SECTIONS.length)
for (const section of SETTINGS_SECTIONS) {
  assert.equal(SETTINGS_SECTION_REGISTRY[section.id], section)
  assert.ok(section.title && section.ariaLabel)
  assert.equal(isSettingsSectionId(section.id), true)
}
assert.equal(isSettingsSectionId("unknown"), false)

console.log("Component registry checks passed.")
