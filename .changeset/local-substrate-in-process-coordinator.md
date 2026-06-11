---
'@atrib/mcp': patch
---

Add an opt-in in-process local substrate coordinator prototype for P042 startup-spawn trials. The helper exposes a transport for the shared coordinator client, signs only bodies whose creator key matches the coordinator signer, reports health through the P042 probe shape, and keeps the default scope to startup-spawn without making a daemon required.
