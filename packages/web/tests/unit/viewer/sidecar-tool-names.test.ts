import { describe, expect, it } from "vitest";
import {
  BROKER_TOOL_LABELS, cardIsForCall, connectionLabelsFromCards, parseToolName, toolLineStatus,
} from "../../../src/viewer/components/sidecar-tool-names.js";
import { BROKER_TOOL_NAMES } from "../../../src/server/sidecar/broker-policy.js";

describe("parseToolName", () => {
  it("labels every broker tool", () => {
    for (const tool of BROKER_TOOL_NAMES) {
      expect(BROKER_TOOL_LABELS[tool], tool).toBeTruthy();
      expect(parseToolName(`mcp__ndx-sidecar__${tool}`)).toMatchObject({ label: BROKER_TOOL_LABELS[tool], broker: tool });
    }
    expect(parseToolName("mcp__ndx-sidecar__run_command").label).toBe("Run command");
    expect(parseToolName("mcp__ndx-sidecar__propose_prd_change").label).toBe("Propose PRD change");
  });

  it("reads an unknown broker tool as its name with spaces", () => {
    expect(parseToolName("mcp__ndx-sidecar__do_new_thing").label).toBe("Do new thing");
  });

  it("reads an external tool as connection · tool, the label when known", () => {
    expect(parseToolName("mcp__ndx-sidecar__fake__create_ticket")).toEqual({
      label: "fake · create ticket", connection: "fake", tool: "create_ticket",
    });
    expect(parseToolName("mcp__ndx-sidecar__fake__create_ticket", { fake: "CAOS" }).label).toBe("CAOS · create ticket");
    expect(parseToolName("mcp__ndx-sidecar__fake__a__b").tool).toBe("a__b");
  });

  it("shows the last segment of any other MCP tool and leaves other names alone", () => {
    expect(parseToolName("mcp__rex__get_item").label).toBe("get_item");
    expect(parseToolName("Bash").label).toBe("Bash");
    expect(parseToolName("").label).toBe("");
    expect(parseToolName("mcp__ndx-sidecar__").label).toBe("mcp__ndx-sidecar__");
  });
});

describe("tool line status and cards", () => {
  const external = {
    tool: "external_call",
    input: { connection: "fake", tool: "create ticket" },
    status: "pending" as const,
    externalCall: { label: "CAOS" },
  };

  it("matches a card to its call", () => {
    expect(cardIsForCall(external, parseToolName("mcp__ndx-sidecar__fake__create_ticket"))).toBe(true);
    expect(cardIsForCall(external, parseToolName("mcp__ndx-sidecar__other__create_ticket"))).toBe(false);
    expect(cardIsForCall({ tool: "run_command", input: {} }, parseToolName("mcp__ndx-sidecar__run_command"))).toBe(true);
    expect(cardIsForCall({ tool: "run_command", input: {} }, parseToolName("Bash"))).toBe(false);
  });

  it("reads connection labels from external-call cards", () => {
    expect(connectionLabelsFromCards([external, { tool: "run_command", input: {}, status: "approved" }])).toEqual({ fake: "CAOS" });
  });

  it("derives running, waiting, failed and done", () => {
    expect(toolLineStatus(undefined, false)).toBe("running");
    expect(toolLineStatus(undefined, true)).toBe("done");
    expect(toolLineStatus(external, false)).toBe("waiting");
    expect(toolLineStatus({ ...external, status: "denied" }, true)).toBe("failed");
    expect(toolLineStatus({ ...external, status: "approved", carriedOut: { ok: false } }, true)).toBe("failed");
    expect(toolLineStatus({ ...external, status: "approved", carriedOut: { ok: true } }, true)).toBe("done");
  });
});
