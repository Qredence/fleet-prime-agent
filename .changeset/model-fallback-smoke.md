---
"@qredence/fleet": patch
---

Fall back to the first available model of a known provider when the requested model id no longer resolves (e.g. a stale persisted default after an upstream catalog change) instead of failing the turn. Unknown providers still error. Also fixes the standalone browser-smoke bundling check to resolve workspace runtime packages.
