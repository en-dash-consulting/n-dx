---
"@n-dx/web": patch
---

The Sidecar Guide lens now has a packet: the queue planner's plan (`ndx work --plan-queue`, read the way `GET /api/hench/plan-queue` reads it) with lanes, reasons, excluded tasks and active runs against the limit, capped at 6k. While `hench.readyNext` is off, `GET /api/sidecar/lenses` reports Guide unavailable, naming that toggle, and no planner is spawned. A new broker tool, `propose_run_plan`, raises a run-plan card of the planner's lanes with their exact `ndx work` commands; it can never be allow-listed. The card's Copy commands copies every lane command with no broker call. Its Start lane approves the card with a `lane` and has the Sidecar raise a work card for the lane's first task only; the lane's other tasks follow on later turns, one approved work card at a time. A work card now shows active runs against the run limit, and approving a start past it is refused with that reason.
