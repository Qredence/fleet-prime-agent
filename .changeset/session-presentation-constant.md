---
"@qredence/fleet": patch
---

Share one cleared-session presentation value

The cleared-session presentation was hand-spelled at four reset sites (initial
state, project switch, session delete, and forbidden-session recovery). A single
shared, frozen value now backs all of them, so a new required field on the
presentation type is a compile-time error in one place instead of a silent gap
in four.
