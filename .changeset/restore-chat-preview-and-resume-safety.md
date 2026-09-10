---
"@qredence/fleet": patch
---

Improve chat-workspace reliability, loading performance, and project safety:

- Keep verified uploaded raster images renderable in previews while preserving forced downloads for other attachments.
- Defer Settings and Fork dialogs until they are first opened, so their lazy chunks stay off the cold-load path.
- Preserve staged attachments when direct or queued sends fail, and reconcile duplicate streamed question frames so answered questions close correctly.
- Ignore stale session-resume failures before recovery can replace a newer session.
- Prevent projects from targeting GitHub CLI credential directories, including relocated XDG configuration paths.
- Keep existing settings with more than 100 resource entries readable while enforcing bounded update requests.
- Allow JSONL exports to create nested directories within the active project without weakening path confinement.
