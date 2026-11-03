---
"@n-dx/core": patch
---

`ndx start --open` no longer passes the sign-in URL to the browser opener, whose argv every local account can read with `ps` while the browser starts. It writes an owner-only redirect page (`open-dashboard.html`) in the ndx home and opens that file instead.
