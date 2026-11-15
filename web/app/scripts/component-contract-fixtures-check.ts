import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import {
	findStaticInlineStyleViolations,
	nativeControlPattern,
	relativeUiImportPattern,
} from "./component-contract-patterns";

const fixtureRoot = resolve(import.meta.dirname, "fixtures", "component-contract");
const readFixture = (name: string) => readFileSync(join(fixtureRoot, name), "utf8");
const parseTsx = (source: string) =>
	ts.createSourceFile("fixture.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

assert.match(readFixture("direct-base-ui.tsx.fixture"), /from ["']@base-ui\/react/);
assert.match(readFixture("native-product-button.tsx.fixture"), nativeControlPattern);
assert.match("<dialog open />", nativeControlPattern);
assert.match('<m.button type="button" />', nativeControlPattern);
assert.doesNotMatch('<Button type="button" />', nativeControlPattern);
assert.match(
	readFixture("unsupported-icon-library.tsx.fixture"),
	/from ["'](?:@tabler\/icons-react|@heroicons\/|react-icons)/,
);

for (const invalidImport of readFixture("relative-ui-imports.tsx.fixture").trim().split("\n")) {
	assert.match(invalidImport, relativeUiImportPattern);
}
assert.doesNotMatch('import { utility } from "../utility"', relativeUiImportPattern);
assert.doesNotMatch('const uiKit = import("../../ui-kit")', relativeUiImportPattern);

const staticStyleViolations = findStaticInlineStyleViolations(parseTsx(readFixture("static-inline-style.tsx.fixture")));
assert.equal(staticStyleViolations.length, 3);
assert.deepEqual(
	staticStyleViolations.map((entry) => entry.properties),
	[["backgroundColor", "position"], ["gridArea", "fontSize", "marginTop"], ["width"]],
);

const dynamicStyleSample = `
export function DynamicStyles() {
  return (
    <>
      <div style={{ "--tree-depth": depth }} />
      <aside style={{ ...style, "--sidebar-width": sidebarWidth }} />
      <div style={{ height: totalHeight }} />
      <div style={{ top: offsets[itemIndex] }} />
      <div style={{ maxHeight }} />
      <div style={{ aspectRatio }} />
      <div style={{ animationDelay: \`\${index * 70}ms\` }} />
      <div style={chatLayoutStyle} />
      <div style={splitStyle} />
      <div style={rowStyle} />
      <span style={token.htmlStyle} />
    </>
  );
}
`;
assert.deepEqual(findStaticInlineStyleViolations(parseTsx(dynamicStyleSample)), []);

const aliasedStyles = parseTsx(`
const chromeStyle = { position: "fixed", top: 0 } as const;
function Shell() {
  const gridStyle = { gridTemplateAreas: '"preview handle tree"', width: measuredWidth };
  return <><div style={chromeStyle} /><div style={gridStyle} /></>;
}
`);
assert.deepEqual(
	findStaticInlineStyleViolations(aliasedStyles).map((entry) => entry.properties),
	[["position", "top"], ["gridTemplateAreas"]],
);
assert.deepEqual(
	findStaticInlineStyleViolations(
		parseTsx(`
const style = { position: "fixed" };
function Dynamic({ style }) { return <div style={style} />; }
`),
	),
	[],
);

console.log("Negative component contract fixtures passed.");
