---
"@qredence/fleet": patch
---

Refresh patch/minor dependencies (Biome 2.5.11, Zod 4.5.4, TanStack Query, lucide-react, shadcn, streamdown, OpenUI libs) and add protocol contract tests. Regenerate the OpenUI contract for the updated schema emitter (equivalent `type: ["string", "number"]` shape). Keep happy-dom pinned at 20.11.6: 20.12.0 throws unhandled AbortErrors from Animation.cancel under motion-dom and fails `test:web`.
