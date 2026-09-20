import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { relativeUiImportPattern } from "./component-contract-patterns"

const fixtureRoot = resolve(import.meta.dirname, "fixtures", "component-contract")
const readFixture = (name: string) => readFileSync(join(fixtureRoot, name), "utf8")

assert.match(readFixture("direct-base-ui.tsx.fixture"), /from ["']@base-ui\/react/)
assert.match(readFixture("native-product-button.tsx.fixture"), /<(?:button|input|select|textarea)\b/)
assert.match(
  readFixture("unsupported-icon-library.tsx.fixture"),
  /from ["'](?:@tabler\/icons-react|@heroicons\/|react-icons)/,
)

for (const invalidImport of readFixture("relative-ui-imports.tsx.fixture").trim().split("\n")) {
  assert.match(invalidImport, relativeUiImportPattern)
}
assert.doesNotMatch('import { utility } from "../utility"', relativeUiImportPattern)
assert.doesNotMatch('const uiKit = import("../../ui-kit")', relativeUiImportPattern)

console.log("Negative component contract fixtures passed.")
