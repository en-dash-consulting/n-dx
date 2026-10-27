---
"@n-dx/graview-face": patch
---

The face now serves through the hub at `/x/graview-face/`. Started by the hub (`PORT`), it listens on 127.0.0.1, where the hub probes, and asks for every script, data file and door route under the mount. `ndx graview serve .` still serves it at the root.
