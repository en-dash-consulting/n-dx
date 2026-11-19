/** Resumed Responses requests can contain previous shell calls and outputs. */
export function shellCheckPassed(input, callId) {
  return !!callId && Array.isArray(input) && input.some(item =>
    item?.type === "function_call_output" && item.call_id === callId &&
    JSON.stringify(item.output ?? "").includes("PR9_PROVIDER_HEADERS_HIDDEN"));
}

export function threadContinued(id, expected) {
  return typeof id === "string" && id.length > 0 && (expected === undefined || id === expected);
}
