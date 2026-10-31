---
"@qredence/fleet": patch
---

Keep the packaged kernel runtime when `fleet-prime` installs Prime Agent

0.10.0 fixed the runtime install inside the web server, but the `fleet-prime`
command installs Prime Agent itself before it starts the server, and that path
still kept only the `prime-agent` executable and deleted the
`prime-agent-runtime` directory the kernel bootstraps from. The server then
reused that binary as-is, so sessions started from the npm package could still
fail with "the runtime bundle that ships beside the Prime Agent binary is
missing".

`fleet-prime` and the server now share one installer. It keeps
`prime-agent-runtime` beside the binary, and an existing binary-only install
under `~/.prime/fleet/runtimes` is repaired automatically on the next start; no
manual cleanup is needed.
