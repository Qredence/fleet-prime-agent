import { SessionManager } from "@earendil-works/pi-coding-agent"
const sm = await SessionManager.openAsync("/Users/zocho/.prime/agent/sessions/019fe8c0-681b-725c-83bd-8e79a6a8243b.jsonl")
console.log("sessionId from jsonl:", sm.getSessionId())
console.log("sessionFile:", sm.getSessionFile())
console.log("cwd:", sm.getCwd())
