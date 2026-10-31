---
"@qredence/fleet": patch
---

Restore the packaged Python kernel runtime on install

Fleet's installer extracted the pinned Prime Agent release, installed only the
executable, and deleted the rest of the payload. The `prime-agent-runtime`
directory the kernel bootstraps from was destroyed on every install, so sessions
failed with "the runtime bundle that ships beside the Prime Agent binary is
missing" even though the release contains it.

The installer now keeps the packaged runtime beside the binary, repairs an
existing binary-only install on the next start, and no longer claims a binary is
missing when the spawn working directory is the thing that does not exist.
