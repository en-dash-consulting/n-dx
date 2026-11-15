/**
 * hench's copy of the local server defaults matches llm-client's.
 *
 * The local tool loop and the `hench run` preflight need the address LM Studio
 * listens on when `llm.local.host`/`llm.local.port` are unset. llm-client owns
 * that default, but hench's llm-gateway is at its export ceiling, so
 * local-endpoint-defaults.ts keeps a mirror. This test is what keeps the mirror honest: change both in
 * the same commit.
 */

import { describe, it, expect } from "vitest";
import {
  DEFAULT_LOCAL_HOST as LLM_CLIENT_DEFAULT_LOCAL_HOST,
  DEFAULT_LOCAL_PORT as LLM_CLIENT_DEFAULT_LOCAL_PORT,
} from "@n-dx/llm-client";
import { DEFAULT_LOCAL_HOST, DEFAULT_LOCAL_PORT } from "../../../../src/agent/lifecycle/local-endpoint-defaults.js";

describe("local server defaults", () => {
  it("match llm-client's canonical host and port", () => {
    expect(DEFAULT_LOCAL_HOST).toBe(LLM_CLIENT_DEFAULT_LOCAL_HOST);
    expect(DEFAULT_LOCAL_PORT).toBe(LLM_CLIENT_DEFAULT_LOCAL_PORT);
  });
});
