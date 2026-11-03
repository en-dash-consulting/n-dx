import { describe, expect, it } from "vitest";
import { CredentialStore } from "../../../src/shared/index.js";
import { sidecarHeaderValue } from "../../../src/hub/proxy.js";

describe("sidecar credential boundary", () => {
  it("withholds both the user token and hub browser sessions, preserving an extension's own bearer", () => {
    const credentials = new CredentialStore({ random: () => "hub-session" });
    const session = credentials.mintSession().credential;
    const forward = { basePath: "/x/test/", token: "user-token", secret: "launch-secret", credentials };
    expect(sidecarHeaderValue("authorization", "Bearer user-token", forward)).toBeNull();
    expect(sidecarHeaderValue("authorization", `Bearer ${session}`, forward)).toBeNull();
    expect(sidecarHeaderValue("authorization", "Bearer extension-token", forward)).toBe("Bearer extension-token");
    expect(sidecarHeaderValue("cookie", "ndx_token=old-token; ndx_session=old-session; theme=dark", forward)).toBe("theme=dark");
    expect(sidecarHeaderValue("x-ndx-token", session, forward)).toBeNull();
  });
});
