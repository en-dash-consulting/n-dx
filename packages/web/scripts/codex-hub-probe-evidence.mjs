// The trusted fixture writes this script as the single readable snapshot.
// Run one known command, so output from other commands or MCP calls cannot
// stand in for observations from the probe.
export const probeCommand = "/bin/sh ./snapshot";
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";

export function boundaryScript(readPaths, writePath, marker) {
  return [
    "export LC_ALL=C",
    `echo ${quote(marker)}`,
    "denial() { case \"$1\" in *\"Operation not permitted\"|*\"Permission denied\") return 0;; *) return 1;; esac; }",
    ...readPaths.map((path, i) =>
      `if msg=$(/bin/cat ${quote(path)} 2>&1); then exit 1; elif denial "$msg"; then echo read${i}=denied; else exit 1; fi`),
    `if msg=$( (printf x > ${quote(writePath)}) 2>&1); then exit 1; elif denial "$msg"; then echo write=denied; else exit 1; fi`,
    'test -z "$NDX_SIDECAR_HEADER_X_NDX_SIDECAR_KEY" && echo HEADERS_HIDDEN',
    "",
  ].join("\n");
}

export function boundaryObserved(events, marker, writeExists) {
  const calls = events.filter((event) => event.type === "tool_use");
  const results = events.filter((event) => event.type === "tool_result");
  const command = calls[0]?.toolCall?.input?.command;
  const exact = command === probeCommand || ["/bin/zsh", "/bin/bash", "/bin/sh"]
    .some((shell) => command === `${shell} -lc '${probeCommand}'`);
  const result = results[0]?.toolResult;
  const valid = calls.length === 1 && calls[0].toolCall?.tool === "shell" && exact
    && results.length === 1 && result?.tool === "shell" && result.isError === false;
  const lines = valid ? result.output.trimEnd().split("\n") : [];
  return {
    snapshot: lines[0] === marker,
    readsDenied: [0, 1, 2].every((i) => lines[i + 1] === `read${i}=denied`),
    writeDenied: lines[4] === "write=denied" && !writeExists,
    headersHidden: lines[5] === "HEADERS_HIDDEN",
    network: "unverified",
  };
}

export function checkThread(phase, expected, persisted, returned) {
  if (!returned || (phase !== "fresh" && (!expected || persisted !== expected || returned !== expected))) {
    throw new Error(`Vendor thread continuity unverified: ${phase}`);
  }
  return returned;
}

export function checkDraftPhase(mode, cards, path, savedContent) {
  const status = { deny: "denied", approve: "approved", stop: "withdrawn" }[mode];
  const [card] = cards;
  if (cards.length !== 1 || card.tool !== "save_draft" || card.status !== status
      || card.input.path !== path || card.input.content !== "DISPOSABLE_DRAFT" || card.input.kind !== "prompt"
      || (mode === "approve" ? card.carriedOut?.ok !== true || savedContent !== "DISPOSABLE_DRAFT"
        : card.carriedOut !== undefined || savedContent !== undefined)) {
    throw new Error(`Card evidence incomplete: ${mode}`);
  }
}
