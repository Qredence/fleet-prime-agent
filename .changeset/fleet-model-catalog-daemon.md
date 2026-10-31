---
"@qredence/fleet": minor
---

Serve the model catalog from the Prime Agent daemon instead of the SDK

Fleet no longer builds or refreshes the stock runtime's `ModelRegistry`. The
model picker reads the pinned daemon's `get_model_catalog`, which re-parses
`models.json` and `auth.json` from disk on every call, through a short-lived
in-process snapshot so a page load does not create a daemon session per request.

Two user-visible fixes come with it:

- Providers configured only through an environment variable now count as
  configured. The retired path hard-coded `configured: false` for environment
  candidates, so a working `ANTHROPIC_API_KEY` or `GROQ_API_KEY` reported its
  models as unavailable and hid them from the default model list.
- A custom provider in `models.json` that is missing `apiKey` now produces an
  actionable diagnostic. The runtime silently drops every custom provider in the
  file in that case, with no error on any surface.

Model thinking levels, the `Unknown model` error, and the stale-model fallback
to a provider's first available model are unchanged.
