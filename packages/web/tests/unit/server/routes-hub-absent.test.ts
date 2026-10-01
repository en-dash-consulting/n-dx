/**
 * The project server's "no hub here" answer to `GET /api/hub/projects`
 * (src/server/routes-hub-absent.ts).
 *
 * The breadcrumb's project switcher asks for the hub's project list on every
 * page. On a standalone server nothing answered it, so every page logged a 404
 * and tests/e2e-ui/navigation.spec.ts failed. The body must keep reading as
 * "not the hub's answer" to the switcher, so this pins both sides.
 */

import { describe, it, expect } from "vitest";
import { handleHubAbsentRoute } from "../../../src/server/routes-hub-absent.js";
import { parseHubProjects } from "../../../src/viewer/components/project-switcher.js";
import { startRouteTestServer } from "../../helpers/server-route-test-support.js";

async function startServer() {
  return startRouteTestServer((req, res) => handleHubAbsentRoute(req, res));
}

describe("GET /api/hub/projects on a project server", () => {
  it("answers 200 { hub: false }", async () => {
    const { baseUrl, close } = await startServer();
    try {
      const res = await fetch(`${baseUrl}/api/hub/projects`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ hub: false });
    } finally {
      await close();
    }
  });

  it("answers the same with a query string", async () => {
    const { baseUrl, close } = await startServer();
    try {
      const res = await fetch(`${baseUrl}/api/hub/projects?_=1`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ hub: false });
    } finally {
      await close();
    }
  });

  it("leaves other methods and other hub paths to the rest of the server", async () => {
    const { baseUrl, close } = await startServer();
    try {
      expect((await fetch(`${baseUrl}/api/hub/projects`, { method: "POST" })).status).toBe(404);
      expect((await fetch(`${baseUrl}/api/hub/queue`)).status).toBe(404);
    } finally {
      await close();
    }
  });

  it("is a body the project switcher reads as no hub", () => {
    expect(parseHubProjects({ hub: false })).toBeNull();
  });
});
