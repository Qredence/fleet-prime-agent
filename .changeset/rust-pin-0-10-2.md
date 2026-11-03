---
"@qredence/fleet": patch
---

Fleet now installs Prime Agent 0.10.2, the latest stock Rust runtime. It brings upstream fixes for Google, Azure OpenAI, Bedrock and Anthropic providers, MCP OAuth issuers with a trailing slash, and stuck Python cells. The protocol is unchanged, so existing sessions keep working; the first launch after updating downloads the new runtime once.
