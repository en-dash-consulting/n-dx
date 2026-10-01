/**
 * "No hub here" — the project server's answer to the hub's own API paths.
 *
 * The breadcrumb's project switcher asks `GET /api/hub/projects` on every page
 * (viewer/components/project-switcher.ts). Behind the hub, the hub answers every
 * `/api/hub/*` path under any prefix itself before proxying (hub/routes.ts), so
 * this route is only reached on a standalone project server — where a 404 would
 * put a console error on every page. `parseHubProjects` reads this body as "not
 * the hub's answer", so the switcher shows nothing, as it does after the 404.
 *
 * GET /api/hub/projects — { hub: false }
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { jsonResponse } from "./response-utils.js";

const HUB_PROJECTS_PATH = "/api/hub/projects";

export function handleHubAbsentRoute(req: IncomingMessage, res: ServerResponse): boolean {
  const url = (req.url || "/").split("?")[0];
  if ((req.method || "GET") !== "GET" || url !== HUB_PROJECTS_PATH) return false;
  jsonResponse(res, 200, { hub: false });
  return true;
}
