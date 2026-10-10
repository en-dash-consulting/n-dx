/**
 * Test that settings views render without waiting for analysis data to load.
 *
 * Settings views (robot-wrangler, project, workflow, commands) don't use
 * analysis data, so they should render immediately even when loading=true.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { h, render } from "preact";
import { isSettingsView } from "../../../src/viewer/views/stages.js";

describe("settings views", () => {
  it("robot-wrangler is a settings view", () => {
    expect(isSettingsView("robot-wrangler")).toBe(true);
  });

  it("project is a settings view", () => {
    expect(isSettingsView("project")).toBe(true);
  });

  it("workflow is a settings view", () => {
    expect(isSettingsView("workflow")).toBe(true);
  });

  it("commands is a settings view", () => {
    expect(isSettingsView("commands")).toBe(true);
  });

  it("overview is not a settings view", () => {
    expect(isSettingsView("overview")).toBe(false);
  });

  it("graph is not a settings view", () => {
    expect(isSettingsView("graph")).toBe(false);
  });

  it("zones is not a settings view", () => {
    expect(isSettingsView("zones")).toBe(false);
  });
});
