/**
 * What each Sidecar lens tells the model about its packet.
 *
 * A builder places its lens's instructions in the packet header, so they count
 * against the lens's cap, open the first turn with the packet and come back
 * with it when a checkpoint rebuilds the packet.
 *
 * Design: local-design-workshop/docs/analysis/sidecar/README.md §3, §5.
 */

/**
 * Explain. The packet labels each capability criterion; the model is held to
 * those labels, and to keeping the two kinds of criteria apart, because
 * "criteria" alone reads as either.
 */
export const EXPLAIN_INSTRUCTIONS = [
  "## How to explain",
  "Explain the target for someone who has not seen it: what it is, where it stands, what backs it.",
  "- Label every capability criterion you mention `met`, `not met` or `not verified`, exactly as the packet does, and cite its evidence. Never upgrade `not verified` to `met`; say what evidence is missing.",
  "- Say \"capability criteria\" for the standing requirements on the product layer (areas and capabilities). Say \"done when\" for a change's or task's acceptance criteria. They are different things: never call one by the other's name.",
  "- Use only what the packet states. Where it says something is not available, say so rather than guess, and name the command that would supply it.",
].join("\n");
