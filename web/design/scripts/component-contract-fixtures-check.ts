import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"

const fixtureRoot = resolve(import.meta.dirname, "fixtures", "component-contract")
const readFixture = (name: string) => readFileSync(join(fixtureRoot, name), "utf8")

assert.match(readFixture("direct-base-ui.tsx.fixture"), /from ["']@base-ui\/react/)
assert.match(readFixture("native-product-button.tsx.fixture"), /<(?:button|input|select|textarea)\b/)
assert.match(
  readFixture("unsupported-icon-library.tsx.fixture"),
  /from ["'](?:@tabler\/icons-react|@heroicons\/|react-icons)/,
)
assert.equal(
  readFixture("undeclared-registry-file.fixture").trim().startsWith("src/components/registry/"),
  true,
)

console.log("Negative component contract fixtures passed.")
