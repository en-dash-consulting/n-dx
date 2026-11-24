import { randomUUID } from "node:crypto";

/** Inspect declarations only, not tool calls retained in resumed history. */
export function advertisedTools(request) {
  const found = [];
  function visit(tools, namespace = "") {
    if (!Array.isArray(tools)) return;
    for (const tool of tools) {
      if (!tool || typeof tool.name !== "string") continue;
      const qualifiedName = namespace ? `${namespace}.${tool.name}` : tool.name;
      found.push({ ...tool, qualifiedName });
      if (tool.type === "namespace") visit(tool.tools, qualifiedName);
    }
  }
  visit(request.tools);
  for (const item of Array.isArray(request.input) ? request.input : []) {
    if (item?.type === "additional_tools" && item.role === "developer") visit(item.tools);
  }
  return found;
}

export function shellCall(request, command, callId) {
  const tools = advertisedTools(request);
  const exec = tools.find(tool => tool.type === "custom" && tool.qualifiedName === "functions.exec");
  if (exec) return {
    id: `ctc_${randomUUID()}`, type: "custom_tool_call", call_id: callId,
    name: "exec", status: "completed",
    input: `const r = await tools.exec_command(${JSON.stringify({ cmd: command, login: false })}); text(r);`,
  };
  const tool = tools.find(tool => tool.type === "function" &&
    ["exec_command", "shell_command", "shell"].includes(tool.qualifiedName));
  if (!tool) throw new Error("Selected CLI did not advertise a supported shell tool; protocol fixture needs review");
  const args = tool.name === "exec_command" ? { cmd: command, login: false }
    : tool.name === "shell_command" ? { command } : { command: ["/bin/sh", "-c", command] };
  return { id: `fc_${randomUUID()}`, type: "function_call", call_id: callId,
    name: tool.name, arguments: JSON.stringify(args), status: "completed" };
}

/** Send complete tool input on added/done; host acceptance verifies CLI consumption. */
export function responseEvents(response) {
  const item = response.output[0];
  return [
    { type: "response.created", response: { ...response, status: "in_progress", output: [] } },
    { type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress" } },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response },
  ];
}

/** Resumed Responses requests can contain previous shell calls and outputs. */
export function shellCheckPassed(input, callId) {
  const marker = "PR9_PROVIDER_HEADERS_HIDDEN";
  return !!callId && Array.isArray(input) && input.some(item => {
    if (item?.call_id !== callId) return false;
    const blocks = typeof item.output === "string" ? [item.output] : Array.isArray(item.output)
      ? item.output.filter(block => block?.type === "input_text").map(block => block.text)
      : [];
    if (!["function_call_output", "custom_tool_call_output"].includes(item.type)) return false;
    // Unstructured legacy output is unproven: even an error can echo the marker.
    // text(r) emits the exec_command result as JSON alongside CLI status text.
    return blocks.some(text => {
      try {
        const result = JSON.parse(text);
        return result?.exit_code === 0 && result.output === marker;
      } catch {
        return false;
      }
    });
  });
}

export function threadContinued(id, expected) {
  return typeof id === "string" && id.length > 0 && (expected === undefined || id === expected);
}
