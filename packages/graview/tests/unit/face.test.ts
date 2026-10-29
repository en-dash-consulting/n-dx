import { describe, it, expect } from "vitest";
import { FACE_EXTENSION, faceEnvironment, findInstalledFace, planProductFace, readFacePlan, type FacePlan } from "../../src/face.js";

const PLAN: FacePlan = { name: FACE_EXTENSION, dir: "/face", execPath: "/node", bin: "/face/bin/serve.js", cwd: "/home/ext/graview-face", env: { HOME: "/u", PORT: "4100" } };

describe("readFacePlan", () => {
  it("runs a launch plan", () => {
    expect(readFacePlan(JSON.stringify(PLAN))).toEqual({ kind: "run", plan: PLAN });
  });

  it("has no face when none is installed or the user disabled it", () => {
    expect(readFacePlan(JSON.stringify({ error: "Error: none", reason: "none" })).kind).toBe("none");
    expect(readFacePlan(JSON.stringify({ error: "Error: disabled", reason: "refused", state: "disabled" })).kind).toBe("none");
  });

  it("refuses with core's message for any other refusal, and for no answer", () => {
    expect(readFacePlan(JSON.stringify({ error: "Error: unapproved — fix: ndx extensions enable graview-face", reason: "refused", state: "unapproved" })))
      .toEqual({ kind: "refused", error: "Error: unapproved — fix: ndx extensions enable graview-face" });
    expect(readFacePlan(JSON.stringify({ error: "Error: bad config", reason: "config" })).kind).toBe("refused");
    expect(readFacePlan("").kind).toBe("refused");
  });
});

describe("planProductFace and findInstalledFace", () => {
  it("ask n-dx from the project root", async () => {
    const asked: Array<[string[], string]> = [];
    const ask = async (args: string[], cwd: string) => {
      asked.push([args, cwd]);
      return args[1] === "sidecar" ? JSON.stringify(PLAN) : JSON.stringify({ dir: "/face", state: "unapproved", reason: "not yet approved" });
    };
    expect(await planProductFace("/project", { ask })).toEqual({ kind: "run", plan: PLAN });
    expect(await findInstalledFace("/project", { ask })).toEqual({ dir: "/face", state: "unapproved", reason: "not yet approved" });
    expect(asked).toEqual([
      [["extensions", "sidecar", FACE_EXTENSION, "--json"], "/project"],
      [["extensions", "info", FACE_EXTENSION, "--json"], "/project"],
    ]);
  });

  it("find nothing without an n-dx CLI to ask", async () => {
    expect((await planProductFace("/project", { env: {} })).kind).toBe("none");
    expect(await findInstalledFace("/project", { env: { NDX_CLI_PATH: "/nowhere/cli.js" } })).toBeUndefined();
  });
});

describe("faceEnvironment", () => {
  it("lays the projection over the plan's environment and leaves the hub's PORT out", () => {
    expect(faceEnvironment(PLAN, { NDX_GRAVIEW_DIR: "/p/.graview" })).toEqual({ HOME: "/u", NDX_GRAVIEW_DIR: "/p/.graview" });
  });
});
