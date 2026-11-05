---
"@qredence/fleet": patch
---

Large custom provider model catalogs (for example Command Code with 95+ models) no longer fail Fleet validation and disappear from Settings → Providers.

Custom provider editing now uses a searchable model list with progressive “Load more” paging instead of a single comma-separated field, so big catalogs stay manageable without hitting the old 64-model wire cap.
