---
"@qredence/fleet": minor
---

Read provider credentials and auth status from `auth.json` instead of the SDK

Fleet now resolves provider credentials itself rather than through the stock
runtime's `AuthStorage` and `ModelRegistry`. Model discovery reads the stored key
from `auth.json` and falls back to the provider's environment variable in the
same order the runtime used. The provider list derives its "configured" state
from the credential file, so a key Fleet wrote a moment ago is visible
immediately instead of only after the runtime reloads its in-memory view.

This removes the SDK from the credential path. Resource discovery (skills,
prompts, themes, extensions) still uses the runtime's loader.
