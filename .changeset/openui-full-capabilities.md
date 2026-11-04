---
"@qredence/fleet": minor
---

OpenUI: fix the integration and use more of the language.

Fixed:

- The component library now declares `Root` as its entry component, so a
  generated program without a `root` statement renders the first root-component
  call with a `no-root` warning instead of rendering nothing.
- `Button`'s action prop is a typed `ActionExpression | string` instead of
  `any`, so the generated prompt teaches `@ToAssistant(...)` and `Action([...])`
  on it and the JSON schema exposes the action contract.
- Generated OpenUI programs can now call Fleet data. `Query(...)` runs through a
  read-only tool surface (`workspace_tree`, `list_sessions`, `list_resources`,
  `session_stats`) backed by Fleet's existing server handlers. The prompt no
  longer documents `Mutation`, because no write tool exists.
- `DataTable` no longer throws when a query is still loading (null rows), and a
  column key that the rows do not carry renders a visible placeholder instead of
  a blank cell that looks like missing data.
- The OpenUI devtools toggle is hidden again; its stylesheet rule matched a
  label the installed devtools no longer emits.

Added:

- Components: `Tabs`, `Accordion`, `TextArea`, `Slider`, `Steps`,
  `KeyValueList`, `Empty`, `Skeleton`, `Image`.
- Client functions: `@Duration`, `@Bytes`, `@Tokens`, `@Percent`,
  `@RelativeTime`, `@ShortPath`.
- Component groups in the prompt so the signature list is navigable.
- A typed `@OpenPanel` action.
- OpenUI form state now survives reload and session switches, stored with
  OpenUI's own message format.
- The Repair action sends structured parser errors (statement, component, hint)
  instead of a generic retry.

Changed:

- `@openuidev/react-ui` was only a stylesheet import with no component
  consumers; it is no longer a dependency.
