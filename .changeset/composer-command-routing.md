---
"@qredence/fleet": patch
---

Add optional composer command routing. With a `TYPESAFE_API_KEY` set on the server and the new Settings → Chat toggle turned on, a message that is really describing a built-in command is recognised: read-only commands run on submit, and state-changing ones are offered as a dismissible chip. Anything else — including every failure mode, a disabled toggle, or a missing key — is sent to the agent exactly as before.
