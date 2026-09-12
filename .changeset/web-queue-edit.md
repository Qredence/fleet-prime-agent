---
"@qredence/fleet": minor
---

Edit queued steering and follow-up messages in place from the Fleet web UI, with the same expected-text guards and queue synchronization as deletion. Empty edits delete; otherwise the message is replaced via the queue PATCH seam.
