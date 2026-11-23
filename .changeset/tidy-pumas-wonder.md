---
"@qredence/fleet": patch
---

Chat state is now a single store instead of a dozen coordinated React values.

The browser already had one reducer for chat stream events, but the state it reduced over was split across seven `useState` values, seven mirror refs, and seven setters that every collaborating hook had to accept as arguments. The POST stream and the SSE channel each re-assembled that state by hand before calling the reducer and then scattered the result back, so the two paths could — and did — drift apart.

`useChatStore` now owns the conversation as one value, and both paths apply events through it. Two consequences are visible in the product:

- An out-of-turn plan update now reaches the composer's plan label. Previously the SSE channel computed the new label and discarded it.
- Reasoning summaries stay available immediately after a stream reconnect, instead of being dropped until the next `connected` frame re-announced the runtime's capabilities.
