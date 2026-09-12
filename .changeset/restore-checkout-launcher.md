---
"@qredence/fleet": patch
---

Restore the source-checkout `fleet-prime.sh` launcher, replace an existing `fleet-agent` symlink instead of writing through it, and keep the web launcher running if an SSR stream times out.
