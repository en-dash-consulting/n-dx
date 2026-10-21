/**
 * Cross-package parity guard for the local LLM endpoint shape rule.
 *
 * `isPlausibleLlmHost` / `isValidPort` are intentionally duplicated between
 * two packages, because the orchestration tier must not import from packages
 * (spawn-only rule):
 *   - packages/llm-client/src/local-endpoint.ts   (canonical — inference builds
 *                                                  the URL from it, and the web
 *                                                  dashboard imports it)
 *   - packages/core/config.js                      (orchestration twin — what
 *                                                  `ndx config llm.local.host`
 *                                                  and `llm.local.port` accept)
 *
 * A divergence means `ndx config` stores a host or port that inference or the
 * dashboard then refuses, or refuses one they would accept — the user sees the
 * same value judged two ways on two surfaces of one product. The table below
 * holds the two copies equal, and holds both to the expected answer so a drift
 * shared by both copies cannot pass as agreement.
 *
 * BOTH twins are imported from SOURCE, for the reason documented at length in
 * windows-quoting-parity.test.js: comparing a source twin against a compiled
 * one makes an unbuilt change look like a divergence.
 */
import { describe, it, expect } from "vitest";
import {
  isPlausibleLlmHost as hostLlm,
  isValidPort as portLlm,
} from "../../packages/llm-client/src/local-endpoint.ts";
import {
  isPlausibleLlmHost as hostCore,
  isValidPort as portCore,
} from "../../packages/core/config.js";

/** [host, accepted] — the shapes a LAN or loopback setup writes, and the ones a URL would misread. */
const HOSTS = [
  ["localhost", true],
  ["127.0.0.1", true],
  ["127.1", true],
  ["[::1]", true],
  ["[0:0:0:0:0:0:0:1]", true],
  ["gpu-box.lan", true],
  ["bücher.lan", true],
  ["GPU-Box.LAN", true],
  ["my_host", true],
  ["", false],
  ["a b", false],
  ["127.0.0.1/x?", false],
  ["u@127.0.0.1", false],
  ["localhost:9999", false],
  ["[::1]:80", false],
  ["::1", false],
  ["a".repeat(254), false],
  // Not strings: a hand-edited .n-dx.json, or a host coerced to a number.
  [undefined, false],
  [null, false],
  [127.1, false],
];

/** [port, accepted] — TCP's range, and what a hand edit can leave behind. */
const PORTS = [
  [1, true],
  [1234, true],
  [65535, true],
  [0, false],
  [-1, false],
  [70000, false],
  [1.5, false],
  ["1234", false],
  [null, false],
  [undefined, false],
  [Number.NaN, false],
];

describe("local endpoint parity: local-endpoint.ts twin === config.js twin", () => {
  it.each(HOSTS)("judges host %j the same way (expected %s)", (host, accepted) => {
    expect(hostCore(host)).toBe(hostLlm(host));
    expect(hostLlm(host)).toBe(accepted);
  });

  it.each(PORTS)("judges port %j the same way (expected %s)", (port, accepted) => {
    expect(portCore(port)).toBe(portLlm(port));
    expect(portLlm(port)).toBe(accepted);
  });
});
