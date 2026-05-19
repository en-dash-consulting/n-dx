/**
 * Scroll reveal — IntersectionObserver-based fade-up animation.
 *
 * Finds all elements matching SECTION_SELECTORS, marks them with
 * `section-reveal`, then adds `in-view` when they enter the viewport.
 * CSS handles the actual opacity/transform transition.
 *
 * Fallbacks:
 * - No IntersectionObserver → all sections revealed immediately.
 * - prefers-reduced-motion → CSS collapses transition to instant;
 *   JS also skips the hidden state entirely.
 */

const SECTION_SELECTORS = [
  ".overview-section",
  ".overview-metrics",
  ".overview-columns",
  ".rex-dash-header",
  ".rex-dash-next",
  ".rex-dash-smart-add",
  ".rex-dash-epics",
  ".rex-dash-panel",
].join(", ");

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function initScrollReveal(): () => void {
  if (typeof IntersectionObserver === "undefined") {
    // Reveal immediately — no animation support.
    document.querySelectorAll(SECTION_SELECTORS).forEach((el) => {
      el.classList.add("in-view");
    });
    return () => { /* noop */ };
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("in-view");
          observer.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.06, rootMargin: "0px 0px -32px 0px" },
  );

  function observe(el: Element): void {
    // Already marked — skip.
    if (el.classList.contains("section-reveal") || el.classList.contains("in-view")) return;
    if (prefersReducedMotion()) {
      el.classList.add("in-view");
    } else {
      el.classList.add("section-reveal");
      observer.observe(el);
    }
  }

  document.querySelectorAll(SECTION_SELECTORS).forEach(observe);

  // Re-scan on DOM mutations (Preact re-renders after navigation).
  const mo = new MutationObserver(() => {
    document.querySelectorAll(SECTION_SELECTORS).forEach(observe);
  });
  mo.observe(document.body, { childList: true, subtree: true });

  // Respect runtime changes to the motion preference.
  const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
  const onMotionChange = (e: MediaQueryListEvent) => {
    if (e.matches) {
      document.querySelectorAll(".section-reveal:not(.in-view)").forEach((el) => {
        el.classList.add("in-view");
      });
    }
  };
  mql.addEventListener("change", onMotionChange);

  return () => {
    observer.disconnect();
    mo.disconnect();
    mql.removeEventListener("change", onMotionChange);
  };
}
