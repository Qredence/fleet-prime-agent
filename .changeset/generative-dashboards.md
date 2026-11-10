---
"@qredence/fleet": minor
---

Add dashboards as attachments that open in the side panel.

Ask for a dashboard and Prime Agent researches it with its normal tools. OpenUI only lays out the figures that reply already stated. The message shows an attachment. Opening it draws the board in the Dashboards tab. A dashboard of this chat still reads this conversation's own activity.

Add a Thesys API key under Settings → Dashboards to let OpenUI Cloud build and edit the board instead. The key stays on the server. `THESYS_API_KEY` and `FLEET_DASHBOARD_MODEL` still override from the environment. A board keeps the mode that created it.
