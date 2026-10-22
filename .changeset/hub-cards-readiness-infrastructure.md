---
"@n-dx/web": patch
---

Hub project cards show the project's SDLC readiness score and how many infrastructure resources its analysis found, from the `readiness` and `infrastructure` fields each project server already reports in `GET /api/status`. A card leaves both off when the project server is an older build that does not report them, and leaves the infrastructure count off when it is zero.
