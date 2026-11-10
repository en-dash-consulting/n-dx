/**
 * Robot Wrangler sections other pages deep-link to. A link carries the key as
 * `?section=<key>`; the page scrolls to the element with the matching id.
 */

export const ROBOT_WRANGLER_SECTIONS = {
  models: "llm-models-section",
  review: "llm-review-section",
} as const;

export type RobotWranglerSection = keyof typeof ROBOT_WRANGLER_SECTIONS;

/** The element id for a `?section=` value, or null when it names no section. */
export function robotWranglerSectionId(key: string | null): string | null {
  return key !== null && Object.hasOwn(ROBOT_WRANGLER_SECTIONS, key)
    ? ROBOT_WRANGLER_SECTIONS[key as RobotWranglerSection]
    : null;
}
