---
"@qredence/fleet": patch
---

Make the composer's inline suggestion adaptive and session-aware. How much of a suggestion is offered now follows how far the matching prompts agree with each other: below 0.5 confidence nothing is shown, between 0.5 and 0.8 only the part every candidate agrees on, and at 0.8 or above the whole continuation — for prompts from the session you are typing in. Cross-session history never extends past the agreed prefix. Since a longer draft narrows the candidate set, a session-tier suggestion lengthens on its own as you type, and shortens when the field is contested instead of committing to a guess.

Prompts from the session you are typing in win outright over the cross-session history, so a session's own vocabulary is preferred and a new session still behaves exactly as before, from the history.

The suggestion corpus now covers your whole history. It used to be read from each session's *model context* — the branch leading to the current leaf, with everything before a compaction boundary replaced by its summary — and to skip sessions over 2 000 messages and anything past the 400 most recently touched. That read saw 473 prompts where the store holds 682: prompts you had written were missing from the very corpus meant to remember them, which is why a follow-up typed mid-conversation so often found nothing. Reading the session's entries instead recovers them. Rebuilds still skip marathon sessions (over 10 000 entries) so a pathological transcript cannot dominate the background build.

The command chip is gone. A recognised command is now offered in the same inline suggestion as a **replacement** — Tab sets the composer to the command rather than running it, so nothing executes without a second, explicit Enter. Escape dismisses the ghost and, for execute-band matches, suppresses auto-run for that draft until you edit it. Tab still belongs to the slash-command and `@mention` menus first.
