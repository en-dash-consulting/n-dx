---
"@n-dx/web": patch
---

The dashboard's setup wizard reports a Google key it could not store. When `ndx config credentials.google --stdin` fails after init, the wizard shows why and how to store the key (`ndx config credentials.google`) and stays on the page instead of redirecting. The message never contains the key. A successful store behaves as before.
