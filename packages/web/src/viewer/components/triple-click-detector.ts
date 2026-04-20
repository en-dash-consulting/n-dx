/**
 * Triple-click gesture detector with probabilistic trigger gate.
 *
 * Self-contained — no rendering imports. Attach the returned handler to any
 * element's onClick. When three consecutive clicks land within `windowMs`
 * of each other AND Math.random() < probability, the `onTrigger` callback
 * fires.
 *
 * @module viewer/components/triple-click-detector
 */

export interface TripleClickDetectorOptions {
  /** Maximum gap between consecutive clicks in ms. Default: 1500. */
  windowMs?: number;
  /** Number of qualifying clicks to arm the trigger. Default: 3. */
  requiredClicks?: number;
  /**
   * Probability that the trigger fires when the gesture is recognised.
   * Default: 0.271828 (≈ 1/e).
   */
  probability?: number;
  /** Called when the gesture is recognised and the probability gate passes. */
  onTrigger: () => void;
}

/** Default probability gate value (≈ 1/e). */
export const TRIPLE_CLICK_PROBABILITY = 0.271828;

/**
 * Creates a click-event handler that tracks a rapid triple-click gesture.
 *
 * Rules:
 * - Each click is recorded with its timestamp.
 * - If the gap from the previous click exceeds `windowMs`, the counter
 *   resets and the latest click becomes click #1.
 * - On the N-th qualifying click (`requiredClicks`) the probability gate is
 *   rolled. If `Math.random() < probability` the `onTrigger` callback fires.
 *   The counter resets regardless of whether the gate passes.
 */
export function createTripleClickDetector(
  options: TripleClickDetectorOptions,
): () => void {
  const {
    windowMs = 1500,
    requiredClicks = 3,
    probability = TRIPLE_CLICK_PROBABILITY,
    onTrigger,
  } = options;

  let timestamps: number[] = [];

  return function handleClick() {
    const now = Date.now();

    if (
      timestamps.length > 0 &&
      now - timestamps[timestamps.length - 1] > windowMs
    ) {
      // Gap too large — start a fresh sequence from this click.
      timestamps = [now];
    } else {
      timestamps.push(now);
    }

    if (timestamps.length >= requiredClicks) {
      timestamps = [];
      if (Math.random() < probability) {
        onTrigger();
      }
    }
  };
}
