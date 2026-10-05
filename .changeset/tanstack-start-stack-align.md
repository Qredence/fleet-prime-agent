---
"@qredence/fleet": patch
---

Bump the bundled web app's TanStack Start stack together: `@tanstack/react-router` 1.170.32 → 1.170.40 and `@tanstack/react-start` 1.168.49 → 1.168.59 (pulling `@tanstack/start-client-core` 1.170.27 → 1.170.33 and `@tanstack/router-core` 1.171.27 → 1.171.33). Moving the router and Start in lockstep keeps the `server.handlers` route-option augmentation aligned for the API routes. No user-facing behavior change is expected.
