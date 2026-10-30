/**
 * Server-sent events from an OpenAI-compatible local server (LM Studio), and
 * the assembly of a streamed chat completion back into the non-streamed shape.
 *
 * A local completion is requested with `stream: true` so the server sends its
 * response headers at once: a non-streamed request gets none until the whole
 * completion is generated, and Node's fetch gives up after 300 s without
 * headers (`UND_ERR_HEADERS_TIMEOUT`). The chunks are then put back together
 * into exactly the object a non-streamed request returns —
 * `choices[i].message.{content, reasoning_content | reasoning, tool_calls}`,
 * `finish_reason` and `usage` — so every caller keeps reading one shape.
 *
 * LM Studio reports a failure after the 200 inside the stream:
 * `event: error` and `data: {"error":{"message":"…"}}` (a context overflow
 * arrives this way, and so does a model-output parse failure). That event's
 * data is returned as `error`, the raw body a non-streamed request would have
 * carried with its 400.
 */

/** One `data:` line of an SSE stream, with the `event:` name in force for it. */
export interface SseData {
  event: string | undefined;
  data: string;
}

/**
 * Yield the `data:` lines of an SSE body as they arrive. Comment lines and
 * blank lines are skipped; an `event:` line names the data lines after it
 * until the blank line that ends the event. Shared by the provider's
 * `stream()` and {@link assembleLocalChatStream}.
 */
export async function* readSseData(body: ReadableStream<Uint8Array>): AsyncGenerator<SseData> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event: string | undefined;

  function* drain(lines: string[]): Generator<SseData> {
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        event = undefined;
        continue;
      }
      if (trimmed.startsWith(":")) continue;
      if (trimmed.startsWith("event:")) {
        event = trimmed.slice(6).trim() || undefined;
        continue;
      }
      if (trimmed.startsWith("data:")) {
        yield { event, data: trimmed.slice(5).trim() };
      }
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      // Keep the last (possibly incomplete) line in the buffer
      buffer = lines.pop() ?? "";
      yield* drain(lines);
    }
    buffer += decoder.decode();
    if (buffer) yield* drain([buffer]);
  } finally {
    reader.releaseLock();
  }
}

interface AssembledToolCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

interface AssembledChoice {
  content: string;
  sawContent: boolean;
  reasoning: Record<string, string>;
  toolCalls: Map<number, AssembledToolCall>;
  finishReason: string | null;
}

/** The outcome of reading a streamed chat completion. */
export type AssembledLocalCompletion =
  | { completion: Record<string, unknown> }
  | { error: string };

/** Delta fields a reasoning model streams its thought in (LM Studio sends `reasoning`). */
const REASONING_FIELDS = ["reasoning_content", "reasoning"] as const;

/**
 * Read a streamed chat completion to its end and assemble the object a
 * non-streamed request would have returned:
 *
 * - `content` deltas are concatenated (`null` when none carried text);
 * - `reasoning_content` / `reasoning` deltas are concatenated under the same key;
 * - `tool_calls` deltas are merged by `index` — the first carries `id`, `type`
 *   and `function.name`, later ones `function.arguments` fragments, which are
 *   concatenated in order;
 * - the last non-null `finish_reason` is kept;
 * - `usage` is the last one sent (the `stream_options.include_usage` chunk),
 *   and absent when the server sent none.
 *
 * A data line that is not JSON is skipped, as the provider's `stream()` does.
 * An `event: error`, or a data object with an `error` field, ends the read
 * with `{ error }` holding that data verbatim.
 */
export async function assembleLocalChatStream(
  body: ReadableStream<Uint8Array>,
): Promise<AssembledLocalCompletion> {
  const choices = new Map<number, AssembledChoice>();
  const meta: Record<string, unknown> = {};
  let usage: unknown;

  for await (const { event, data } of readSseData(body)) {
    if (data === "[DONE]") break;
    let chunk: Record<string, unknown>;
    try {
      chunk = JSON.parse(data) as Record<string, unknown>;
    } catch {
      if (event === "error") return { error: data };
      continue;
    }
    if (event === "error" || (chunk.error !== undefined && chunk.error !== null)) {
      return { error: data };
    }

    for (const key of ["id", "created", "model", "system_fingerprint"]) {
      if (chunk[key] !== undefined && meta[key] === undefined) meta[key] = chunk[key];
    }
    if (chunk.usage) usage = chunk.usage;

    const deltas = Array.isArray(chunk.choices) ? chunk.choices as Array<Record<string, unknown>> : [];
    for (const raw of deltas) {
      const index = typeof raw.index === "number" ? raw.index : 0;
      let choice = choices.get(index);
      if (!choice) {
        choice = { content: "", sawContent: false, reasoning: {}, toolCalls: new Map(), finishReason: null };
        choices.set(index, choice);
      }
      if (typeof raw.finish_reason === "string") choice.finishReason = raw.finish_reason;

      const delta = (raw.delta ?? {}) as Record<string, unknown>;
      if (typeof delta.content === "string") {
        choice.content += delta.content;
        if (delta.content) choice.sawContent = true;
      }
      for (const field of REASONING_FIELDS) {
        const piece = delta[field];
        if (typeof piece === "string") choice.reasoning[field] = (choice.reasoning[field] ?? "") + piece;
      }
      const toolDeltas = Array.isArray(delta.tool_calls) ? delta.tool_calls as Array<Record<string, unknown>> : [];
      for (const td of toolDeltas) {
        const callIndex = typeof td.index === "number" ? td.index : choice.toolCalls.size;
        let call = choice.toolCalls.get(callIndex);
        if (!call) {
          call = { id: "", type: "function", function: { name: "", arguments: "" } };
          choice.toolCalls.set(callIndex, call);
        }
        if (typeof td.id === "string" && td.id) call.id = td.id;
        if (typeof td.type === "string" && td.type) call.type = td.type;
        const fn = (td.function ?? {}) as Record<string, unknown>;
        // The name comes whole in the call's first delta; some servers repeat it.
        if (typeof fn.name === "string" && fn.name && !call.function.name) call.function.name = fn.name;
        if (typeof fn.arguments === "string") call.function.arguments += fn.arguments;
      }
    }
  }

  const assembledChoices = [...choices.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, choice]) => {
      const message: Record<string, unknown> = {
        role: "assistant",
        content: choice.sawContent ? choice.content : null,
        ...choice.reasoning,
      };
      if (choice.toolCalls.size > 0) {
        message.tool_calls = [...choice.toolCalls.entries()]
          .sort(([a], [b]) => a - b)
          .map(([, call]) => call);
      }
      return { index, message, finish_reason: choice.finishReason };
    });

  return {
    completion: {
      ...meta,
      object: "chat.completion",
      choices: assembledChoices,
      ...(usage !== undefined ? { usage } : {}),
    },
  };
}
