import { describe, it, expect } from "vitest";
import { acceptsImageInput } from "../../src/public.js";

describe("acceptsImageInput", () => {
  it("is true for the hosted vendors' current models, and for their defaults", () => {
    expect(acceptsImageInput("claude", "claude-opus-5-5")).toBe(true);
    expect(acceptsImageInput("claude", null)).toBe(true);
    expect(acceptsImageInput("codex", "gpt-5.5-codex")).toBe(true);
    expect(acceptsImageInput("google", "gemini-3-pro")).toBe(true);
  });

  it("is false for a hosted vendor's text-only families", () => {
    expect(acceptsImageInput("claude", "claude-2.1")).toBe(false);
    expect(acceptsImageInput("codex", "o3-mini")).toBe(false);
    expect(acceptsImageInput("codex", "GPT-3.5-turbo")).toBe(false);
  });

  it("is true for a local model only when its name says it is a vision model", () => {
    expect(acceptsImageInput("local", "llava:13b")).toBe(true);
    expect(acceptsImageInput("local", "qwen2.5vl:7b")).toBe(true);
    expect(acceptsImageInput("local", "qwen2.5-vl")).toBe(true);
    expect(acceptsImageInput("local", "llama3.2-vision")).toBe(true);
    expect(acceptsImageInput("local", "qwen2.5-coder:14b")).toBe(false);
    expect(acceptsImageInput("local", "deepseek-r1:8b")).toBe(false);
    expect(acceptsImageInput("local", null)).toBe(false);
  });

  it("is false for an unset or unknown vendor", () => {
    expect(acceptsImageInput(null, "claude-opus-5-5")).toBe(false);
    expect(acceptsImageInput("other", "x")).toBe(false);
  });
});
