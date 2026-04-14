function normalize(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, " ");
}

function bigrams(text: string): Set<string> {
  const grams = new Set<string>();
  for (let i = 0; i < text.length - 1; i++) {
    grams.add(text.slice(i, i + 2));
  }
  return grams;
}

function wordSet(text: string): Set<string> {
  return new Set(text.split(" ").filter(Boolean));
}

const ACTION_SYNONYM_MAP: Record<string, string> = {
  add: "implement",
  implement: "implement",
  create: "implement",
  build: "implement",
  setup: "implement",
  set: "implement",
  introduce: "implement",
  fix: "fix",
  resolve: "fix",
  repair: "fix",
  patch: "fix",
  refactor: "refactor",
  restructure: "refactor",
  reorganize: "refactor",
  clean: "refactor",
  update: "update",
  upgrade: "update",
  improve: "update",
  enhance: "update",
  optimize: "update",
  remove: "remove",
  delete: "remove",
  drop: "remove",
  investigate: "investigate",
  analyze: "investigate",
  review: "investigate",
  audit: "investigate",
};

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "for", "to", "in", "of", "on", "with",
  "is", "be", "up", "by", "at", "as", "its", "it", "this", "that",
]);

function splitActionContent(text: string): { verb: string | null; content: string } {
  const words = text.split(" ").filter(Boolean);
  if (words.length === 0) return { verb: null, content: "" };

  const first = words[0].replace(/:$/, "");
  const canonical = ACTION_SYNONYM_MAP[first];
  if (canonical) {
    let skip = 1;
    if (first === "set" && words.length > 1 && words[1] === "up") skip = 2;
    const contentWords = words.slice(skip).filter((word) => !STOPWORDS.has(word));
    return { verb: canonical, content: contentWords.join(" ") };
  }

  const contentWords = words.filter((word) => !STOPWORDS.has(word));
  return { verb: null, content: contentWords.join(" ") };
}

function rawSimilarity(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return 0;
  if (a === b) return 1.0;

  if (a.includes(b) || b.includes(a)) {
    const shorter = Math.min(a.length, b.length);
    const longer = Math.max(a.length, b.length);
    return Math.max(0.7, shorter / longer);
  }

  const bigramsA = bigrams(a);
  const bigramsB = bigrams(b);
  let bigramScore = 0;
  if (bigramsA.size > 0 && bigramsB.size > 0) {
    let intersection = 0;
    for (const gram of bigramsA) {
      if (bigramsB.has(gram)) intersection++;
    }
    bigramScore = (2 * intersection) / (bigramsA.size + bigramsB.size);
  }

  const wordsA = wordSet(a);
  const wordsB = wordSet(b);
  let wordScore = 0;
  if (wordsA.size > 0 && wordsB.size > 0) {
    let matched = 0;
    let prefixPairs = 0;

    for (const word of wordsA) {
      if (wordsB.has(word)) {
        matched++;
        continue;
      }

      for (const other of wordsB) {
        if (other.startsWith(word) || word.startsWith(other)) {
          matched += 0.8;
          prefixPairs++;
          break;
        }
      }
    }

    const rawUnion = new Set([...wordsA, ...wordsB]).size;
    const effectiveUnion = rawUnion - prefixPairs;
    wordScore = matched / effectiveUnion;
  }

  return Math.max(bigramScore, wordScore);
}

export function similarity(a: string, b: string): number {
  const normalizedA = normalize(a);
  const normalizedB = normalize(b);

  if (normalizedA.length === 0 || normalizedB.length === 0) return 0;
  if (normalizedA === normalizedB) return 1.0;

  const fullScore = rawSimilarity(normalizedA, normalizedB);
  const actionA = splitActionContent(normalizedA);
  const actionB = splitActionContent(normalizedB);

  if (actionA.verb && actionB.verb && actionA.content.length > 0 && actionB.content.length > 0) {
    const contentScore = rawSimilarity(actionA.content, actionB.content);
    if (actionA.verb === actionB.verb) {
      return Math.min(contentScore * 0.85 + 0.15, 1.0);
    }
    return contentScore * 0.85;
  }

  return fullScore;
}
