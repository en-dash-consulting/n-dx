/**
 * Pure helpers for java-scip-compare.mjs: a minimal SCIP reader and the
 * edge comparison. Kept free of I/O so tests can drive them with a
 * hand-built index. No protobuf dependency: the few fields needed are decoded
 * directly from the wire format.
 *
 * SCIP schema (scip.proto): Index{documents=2}, Document{relative_path=1,
 * occurrences=2}, Occurrence{symbol=2, symbol_roles=3}. Role bit 0x1 marks a
 * definition.
 */

const DEFINITION_ROLE = 0x1;

/** Iterate `[fieldNumber, wireType, value]` over one protobuf message; `value` is a number or a Buffer slice. */
function* fields(buf) {
  let pos = 0;
  const varint = () => {
    let result = 0;
    let scale = 1;
    for (;;) {
      if (pos >= buf.length) throw new Error("truncated varint");
      const byte = buf[pos++];
      result += (byte & 0x7f) * scale;
      if (byte < 0x80) return result;
      scale *= 128;
    }
  };
  while (pos < buf.length) {
    const tag = varint();
    const field = Math.floor(tag / 8);
    const wire = tag % 8;
    if (wire === 0) {
      yield [field, wire, varint()];
    } else if (wire === 2) {
      const len = varint();
      if (pos + len > buf.length) throw new Error("truncated field");
      yield [field, wire, buf.subarray(pos, pos + len)];
      pos += len;
    } else if (wire === 1 || wire === 5) {
      const size = wire === 1 ? 8 : 4;
      if (pos + size > buf.length) throw new Error("truncated fixed field");
      yield [field, wire, buf.subarray(pos, pos + size)];
      pos += size;
    } else {
      throw new Error(`unsupported wire type ${wire}`);
    }
  }
}

/**
 * Decode a SCIP index into `[{ path, occurrences: [{ symbol, definition }] }]`.
 * Throws on a malformed buffer.
 */
export function readScipDocuments(buf) {
  const documents = [];
  for (const [field, , value] of fields(buf)) {
    if (field !== 2) continue;
    const doc = { path: "", occurrences: [] };
    for (const [f, , v] of fields(value)) {
      if (f === 1) {
        doc.path = v.toString("utf8");
      } else if (f === 2) {
        let symbol = "";
        let roles = 0;
        for (const [of, , ov] of fields(v)) {
          if (of === 2) symbol = ov.toString("utf8");
          else if (of === 3) roles = ov;
        }
        doc.occurrences.push({ symbol, definition: (roles & DEFINITION_ROLE) !== 0 });
      }
    }
    documents.push(doc);
  }
  return documents;
}

function isTypeSymbol(symbol) {
  return symbol.length > 0 && !symbol.startsWith("local ") && symbol.endsWith("#");
}

/** `<type>#`<init>`(<disambiguator>).` (any overload) is a constructor of `<type>#`. */
const CONSTRUCTOR = /^(.+#)`<init>`\([^)]*\)\.$/;

/** The type symbol a reference counts toward: itself, its owner for a constructor, else undefined. */
function referencedType(symbol) {
  if (symbol.startsWith("local ")) return undefined;
  const type = CONSTRUCTOR.exec(symbol)?.[1] ?? symbol;
  return isTypeSymbol(type) ? type : undefined;
}

export const edgeKey = (from, to) => `${from}\0${to}`;

/**
 * Reduce documents to file-to-file reference edges. Only type symbols count
 * (descriptor ends in `#`), plus constructor symbols, which count as references
 * to their type (`new T()` is recorded as `T#`<init>`().`): the resolver models
 * type references, so other method and field symbols would score its design,
 * not its accuracy. Edges are limited to
 * `files` (the repository's own `.java` files) and drop self-references.
 *
 * @returns {Set<string>} {@link edgeKey} values
 */
export function scipEdges(documents, files) {
  const inRepo = new Set(files);
  const definedIn = new Map();
  for (const doc of documents) {
    if (!inRepo.has(doc.path)) continue;
    for (const occ of doc.occurrences) {
      if (occ.definition && isTypeSymbol(occ.symbol) && !definedIn.has(occ.symbol)) definedIn.set(occ.symbol, doc.path);
    }
  }
  const edges = new Set();
  for (const doc of documents) {
    if (!inRepo.has(doc.path)) continue;
    for (const occ of doc.occurrences) {
      if (occ.definition) continue;
      const type = referencedType(occ.symbol);
      const target = type === undefined ? undefined : definedIn.get(type);
      if (target !== undefined && target !== doc.path) edges.add(edgeKey(doc.path, target));
    }
  }
  return edges;
}

const dirOf = (path) => path.slice(0, Math.max(0, path.lastIndexOf("/")));

/** `same-directory` (same package in the usual layout) or `cross-directory`. */
export function edgeKind(from, to) {
  return dirOf(from) === dirOf(to) ? "same-directory" : "cross-directory";
}

/** Counts by kind plus the target files most often involved, each with one sample source. */
function summarize(keys, top) {
  const byKind = {};
  const byTarget = new Map();
  for (const key of keys) {
    const [from, to] = key.split("\0");
    const kind = edgeKind(from, to);
    byKind[kind] = (byKind[kind] ?? 0) + 1;
    const entry = byTarget.get(to) ?? { target: to, count: 0, sampleFrom: from };
    entry.count++;
    byTarget.set(to, entry);
  }
  return {
    total: keys.length,
    byKind,
    topTargets: [...byTarget.values()].sort((a, b) => b.count - a.count || a.target.localeCompare(b.target)).slice(0, top),
  };
}

/** Precision, recall and the grouped unmatched edges for resolver vs. SCIP edge sets. */
export function compareEdges(resolverEdges, scip, { top = 10 } = {}) {
  const extra = [...resolverEdges].filter((k) => !scip.has(k));
  const missed = [...scip].filter((k) => !resolverEdges.has(k));
  const matched = resolverEdges.size - extra.length;
  return {
    resolver: resolverEdges.size,
    scip: scip.size,
    matched,
    precision: resolverEdges.size === 0 ? 0 : matched / resolverEdges.size,
    recall: scip.size === 0 ? 0 : matched / scip.size,
    // In the resolver but not SCIP: false positives.
    extra: summarize(extra, top),
    // In SCIP but not the resolver: false negatives.
    missed: summarize(missed, top),
  };
}

/** Proposed gate G2 floor: the lowest measured value less a margin, rounded down to a whole percent. */
export function proposeThreshold(values, margin = 0.02) {
  if (values.length === 0) return undefined;
  return Math.max(0, Math.floor((Math.min(...values) - margin) * 100) / 100);
}
