import { expect, it } from "vitest";
import { shellCheckPassed, threadContinued, shellCall, advertisedTools, responseEvents } from "../../packages/web/scripts/sidecar-provider-probe-checks.mjs";

it("requires the current call's result and a real thread id for host evidence", () => {
  const prior = { type: "function_call_output", call_id: "old", output: JSON.stringify({ exit_code: 0, output: "PR9_PROVIDER_HEADERS_HIDDEN" }) };
  expect(shellCheckPassed([prior, { ...prior, call_id: "new", output: "exit 1" }], "new")).toBe(false);
  expect(shellCheckPassed([{ ...prior, call_id: "new" }], "new")).toBe(true);
  expect(threadContinued(undefined, undefined)).toBe(false);
  expect(threadContinued("another", "first")).toBe(false);
  expect(threadContinued("first", "first")).toBe(true);
});

const additional = (...tools) => ({ input: [{ type: "additional_tools", role: "developer", tools }] });
const customRequest = additional({ type: "namespace", name: "functions", tools: [{ type: "custom", name: "exec" }, { type: "function", name: "wait" }] });

it("uses the installed CLI's additional functions.exec custom tool without a namespace on the call", async () => {
  const command = "/bin/sh '/fixture path/check'";
  const item = shellCall(customRequest, command, "current");
  expect(item).toMatchObject({ type: "custom_tool_call", name: "exec", call_id: "current", status: "completed" });
  expect(item).not.toHaveProperty("namespace");
  let received;
  let printed;
  await new Function("tools", "text", `return (async () => { ${item.input} })()`)(
    { exec_command: async args => { received = args; return { exit_code: 0 }; } }, value => { printed = value; });
  expect(received).toEqual({ cmd: command, login: false });
  expect(printed).toEqual({ exit_code: 0 });
});

it.each(["exec_command", "shell_command", "shell"])("retains standard %s function tools", name => {
  const item = shellCall({ tools: [{ type: "function", name }] }, "check", "current");
  expect(item).toMatchObject({ type: "function_call", name, call_id: "current" });
  expect(JSON.parse(item.arguments)).toEqual(name === "exec_command" ? { cmd: "check", login: false } : name === "shell_command" ? { command: "check" } : { command: ["/bin/sh", "-c", "check"] });
});

it("detects unrelated namespace and leaf tools in both advertisement locations", () => {
  for (const request of [
    { tools: [{ type: "function", name: "mcp__unrelated__read" }] },
    additional({ type: "namespace", name: "unrelated", tools: [{ type: "function", name: "read" }] }),
    additional({ type: "namespace", name: "functions", tools: [{ type: "function", name: "mcp__unrelated__read" }] }),
  ]) expect(advertisedTools(request).some(tool => /unrelated/.test(tool.qualifiedName))).toBe(true);
  expect(() => shellCall(additional({ type: "namespace", name: "other", tools: [{ type: "custom", name: "exec" }] }), "check", "current")).toThrow(/supported shell tool/);
});

it.each(["function_call_output", "custom_tool_call_output"])("requires current %s output, never historical markers or metadata", type => {
  const marker = "PR9_PROVIDER_HEADERS_HIDDEN";
  const text = JSON.stringify({ exit_code: 0, output: marker });
  const old = { type, call_id: "old", output: [{ type: "input_text", text }] };
  expect(shellCheckPassed([old], "current")).toBe(false);
  expect(shellCheckPassed([old, { ...old, call_id: "current", output: [{ type: "input_text", text: "exit 1" }] }], "current")).toBe(false);
  expect(shellCheckPassed([{ ...old, call_id: "current" }], "current")).toBe(true);
  expect(shellCheckPassed([{ ...old, call_id: "current", output: [{ type: "image", text: "PR9_PROVIDER_HEADERS_HIDDEN" }] }], "current")).toBe(false);
  expect(shellCheckPassed([{ type: "custom_tool_call", call_id: "current", input: "PR9_PROVIDER_HEADERS_HIDDEN" }], "current")).toBe(false);
});

it.each(["function_call_output", "custom_tool_call_output"])("rejects %s errors that echo the marker", type => {
  const marker = "PR9_PROVIDER_HEADERS_HIDDEN";
  for (const output of [marker, `Error: /tmp/${marker}/snapshot missing`, JSON.stringify({ exit_code: 0, output: `prefix ${marker}` })]) {
    expect(shellCheckPassed([{ type, call_id: "current", output }], "current")).toBe(false);
  }
  for (const result of [
    { exit_code: 127, output: `/bin/sh: /tmp/${marker}/snapshot: No such file or directory` },
    { exit_code: 1, output: marker },
    { exit_code: null, session_id: 123, output: marker },
    { exit_code: 0, output: "", diagnostic: marker },
  ]) {
    const output = [{ type: "input_text", text: JSON.stringify(result) }];
    expect(shellCheckPassed([{ type, call_id: "current", output }], "current")).toBe(false);
  }
});

it.each([customRequest, { tools: [{ type: "function", name: "exec_command" }] }])("streams the selected tool through Responses SSE", request => {
  const item = shellCall(request, "check", "current");
  const events = responseEvents({ id: "response", status: "completed", output: [item] });
  expect(events.map(event => event.type)).toEqual(["response.created", "response.output_item.added", "response.output_item.done", "response.completed"]);
  expect(events[0].response).toMatchObject({ status: "in_progress", output: [] });
  expect(events[1].item).toMatchObject({ type: item.type, status: "in_progress" });
  expect(events[2].item).toEqual(item);
  expect(events[3].response.output).toEqual([item]);
});
