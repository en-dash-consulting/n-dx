---
"@n-dx/graview-face": patch
---

The face now serves through the hub at `/x/graview-face/`. Started by the hub (`PORT` with `NDX_EXTENSION_NAME`), it listens on 127.0.0.1, where the hub probes, and asks for every script, data file and door route under the mount; a request that already carries the mount is served as it is. `ndx graview serve .`, and a run by hand even with `PORT` set, still serve it at the root.
