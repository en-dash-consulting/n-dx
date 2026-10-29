/**
 * The hub's `apiVersion` must be the extension contract version core speaks.
 *
 * `packages/web/src/hub/extensions.ts` carries a twin of core's
 * `EXTENSION_API_VERSION`: the hub cannot import core, so the versioned hub
 * endpoints state the number themselves. Root-level because only here can
 * both packages be imported at once. Drift would tell an extension that the
 * hub speaks a contract the CLI handing it `NDX_EXTENSION_API` does not.
 */

import { describe, it, expect } from "vitest";

import { EXTENSION_API_VERSION as coreVersion } from "../../packages/core/extension-env.js";
import { EXTENSION_API_VERSION as hubVersion } from "../../packages/web/dist/hub/extensions.js";

describe("extension apiVersion parity", () => {
  it("the hub's apiVersion is core's EXTENSION_API_VERSION", () => {
    expect(hubVersion).toBe(coreVersion);
  });
});
