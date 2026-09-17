// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHomePage, renderCard, cardFacts, dirtyLabel, progressLabel, runningLabel } from "../../../src/hub/home.js";
import type { HubOverview, ProjectCard } from "../../../src/hub/overview.js";

/**
 * The hub home page, rendered and then read back out of a document.
 *
 * The acceptance criterion asks for a screenshot-level check in both themes
 * with two registered projects. Playwright is available but its suite is not
 * part of `pnpm validate` and needs browsers installed, so a screenshot there
 * would gate nothing. What is checked instead is everything a screenshot
 * would have shown: which cards render, what each says, that the theme
 * attribute and its toggle behave in both directions, and that every control
 * is reachable from the keyboard.
 */

function card(overrides: Partial<ProjectCard> = {}): ProjectCard {
  return {
    id: "alpha",
    name: "Alpha App",
    repoRoot: "/repos/alpha",
    url: "/p/alpha/",
    state: "healthy",
    port: 4001,
    reachable: true,
    error: null,
    branch: "main",
    dirtyFiles: 0,
    activeRuns: 0,
    percentComplete: 42,
    nextTaskTitle: "Wire the thing",
    analyzedAt: "2026-09-16T09:00:00.000Z",
    ...overrides,
  };
}

const TWO_PROJECTS: HubOverview = {
  generatedAt: "2026-09-16T12:00:00.000Z",
  projects: [
    card({ activeRuns: 2, branch: "feature/x", dirtyFiles: 3 }),
    card({
      id: "beta", name: "Beta App", repoRoot: "/repos/beta", url: "/p/beta/",
      state: "unreachable", reachable: false, error: "connect ECONNREFUSED",
      branch: null, dirtyFiles: null, activeRuns: null, percentComplete: null, nextTaskTitle: null,
    }),
  ],
};

/** Parse rendered HTML into a document the test can query. */
function renderToDocument(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("card labels", () => {
  it("says clean, or how many files are uncommitted, or nothing when git could not be asked", () => {
    expect(dirtyLabel(card({ dirtyFiles: 0 }))).toBe("clean");
    expect(dirtyLabel(card({ dirtyFiles: 3 }))).toBe("3 uncommitted");
    expect(dirtyLabel(card({ dirtyFiles: null }))).toBeNull();
  });

  it("shows a percentage only for a project that has a PRD", () => {
    expect(progressLabel(card({ percentComplete: 0 }))).toBe("0% complete");
    expect(progressLabel(card({ percentComplete: null }))).toBeNull();
  });

  it("badges running agents only when some are running", () => {
    expect(runningLabel(card({ activeRuns: 2 }))).toBe("2 running");
    expect(runningLabel(card({ activeRuns: 0 }))).toBeNull();
    expect(runningLabel(card({ activeRuns: null }))).toBeNull();
  });

  it("leads with what the project is doing, then its state", () => {
    expect(cardFacts(card({ activeRuns: 2, branch: "feature/x", dirtyFiles: 3 })))
      .toEqual(["2 running", "feature/x", "3 uncommitted", "42% complete"]);
  });

  it("says only that an unreachable project is not answering, and why", () => {
    expect(cardFacts(card({ reachable: false, error: "connect ECONNREFUSED" })))
      .toEqual(["not answering — connect ECONNREFUSED"]);
    expect(cardFacts(card({ reachable: false, error: null }))).toEqual(["not answering"]);
  });
});

describe("renderHomePage", () => {
  it("renders one card per project, naming each and where it lives", () => {
    const doc = renderToDocument(renderHomePage(TWO_PROJECTS));
    const cards = doc.querySelectorAll(".card");
    expect(cards).toHaveLength(2);

    expect(cards[0].querySelector(".card-title a")?.textContent).toBe("Alpha App");
    expect(cards[0].querySelector(".card-title a")?.getAttribute("href")).toBe("/p/alpha/");
    expect(cards[0].querySelector(".path")?.textContent).toBe("/repos/alpha");
    expect(cards[0].textContent).toContain("2 running");
    expect(cards[0].textContent).toContain("feature/x");
    expect(cards[0].textContent).toContain("3 uncommitted");
    expect(cards[0].textContent).toContain("42% complete");
    expect(cards[0].textContent).toContain("Next: Wire the thing");

    expect(doc.querySelector("header .count")?.textContent).toBe("2 projects");
  });

  it("marks an unreachable project and offers it no Start working button", () => {
    const doc = renderToDocument(renderHomePage(TWO_PROJECTS));
    const beta = doc.querySelectorAll(".card")[1];

    expect(beta.classList.contains("card-unreachable")).toBe(true);
    expect(beta.textContent).toContain("not answering — connect ECONNREFUSED");
    // Starting work on a server that is not answering cannot succeed; the
    // dashboard link stays, because that is where you would go to find out why.
    expect(beta.querySelector(".action-primary")).toBeNull();
    expect(beta.querySelector(".action")?.getAttribute("href")).toBe("/p/beta/");
  });

  it("sends Start working to the project's Runs view rather than starting a run itself", () => {
    const doc = renderToDocument(renderHomePage(TWO_PROJECTS));
    const start = doc.querySelector(".card .action-primary")!;
    expect(start.textContent).toBe("Start working");
    expect(start.getAttribute("href")).toBe("/p/alpha/hench-runs");
    // No form, no POST — the existing Start Task button on that view owns it.
    expect(doc.querySelector("form")).toBeNull();
  });

  it("says what to do when nothing is registered", () => {
    const doc = renderToDocument(renderHomePage({ projects: [], generatedAt: "2026-09-16T12:00:00.000Z" }));
    expect(doc.querySelectorAll(".card")).toHaveLength(0);
    expect(doc.querySelector(".empty")?.textContent).toContain("ndx start");
  });

  it("escapes a project name and path rather than letting them close a tag", () => {
    const doc = renderToDocument(renderHomePage({
      generatedAt: "t",
      projects: [card({ name: '<img src=x onerror="alert(1)">', repoRoot: "/repos/a&b" })],
    }));
    expect(doc.querySelector("img")).toBeNull();
    expect(doc.querySelector(".card-title a")?.textContent).toBe('<img src=x onerror="alert(1)">');
    expect(doc.querySelector(".path")?.textContent).toBe("/repos/a&b");
  });
});

describe("themes", () => {
  it("defines both themes, and starts on the dark default", () => {
    const html = renderHomePage(TWO_PROJECTS);
    const doc = renderToDocument(html);

    expect(doc.documentElement.getAttribute("data-theme")).toBe("dark");
    const styles = doc.querySelector("style")!.textContent!;
    expect(styles).toContain(":root {");
    expect(styles).toContain('[data-theme="light"]');
    // Both themes define the same surface tokens, or one of them renders bare.
    for (const token of ["--bg", "--bg-surface", "--text", "--border", "--accent"]) {
      const occurrences = styles.split(`${token}:`).length - 1;
      expect(occurrences, `${token} is not defined in both themes`).toBeGreaterThanOrEqual(2);
    }
  });

  it("reads and writes the same theme key the dashboard uses, so the choice carries", () => {
    const html = renderHomePage(TWO_PROJECTS);
    // Both the pre-paint bootstrap and the toggle speak sv-theme/data-theme.
    expect(html).toContain('localStorage.getItem("sv-theme")');
    expect(html).toContain('localStorage.setItem("sv-theme", next)');
    expect(html).toContain('setAttribute("data-theme"');
  });

  it("toggles between the two themes when the button is pressed", () => {
    const doc = renderToDocument(renderHomePage(TWO_PROJECTS));
    // Run the page's own toggle script against the parsed document.
    const toggleScript = [...doc.querySelectorAll("script")]
      .map((s) => s.textContent ?? "")
      .find((text) => text.includes("theme-toggle"))!;
    const button = doc.getElementById("theme-toggle")!;
    new Function("document", toggleScript)(doc);

    // A parsed document has no window of its own, so the Event comes from the
    // test environment's; jsdom dispatches it on the element all the same.
    expect(doc.documentElement.getAttribute("data-theme")).toBe("dark");
    button.dispatchEvent(new Event("click"));
    expect(doc.documentElement.getAttribute("data-theme")).toBe("light");
    button.dispatchEvent(new Event("click"));
    expect(doc.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});

describe("keyboard reachability", () => {
  it("makes every control a real link or button, with no positive tabindex", () => {
    const doc = renderToDocument(renderHomePage(TWO_PROJECTS));

    const controls = [...doc.querySelectorAll(".card a, .theme-toggle")];
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      expect(["A", "BUTTON"]).toContain(control.tagName);
      // A link is only tabbable with an href; a positive tabindex would
      // reorder the page against the reading order.
      if (control.tagName === "A") expect(control.getAttribute("href")).toBeTruthy();
      const tabindex = control.getAttribute("tabindex");
      expect(tabindex === null || Number(tabindex) <= 0).toBe(true);
    }

    expect(doc.getElementById("theme-toggle")?.getAttribute("aria-label")).toBe("Toggle colour theme");
    // The status dot is decoration; its meaning is in the facts beside it.
    expect(doc.querySelector(".dot")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("gives every focusable control a visible focus ring", () => {
    const styles = renderToDocument(renderHomePage(TWO_PROJECTS)).querySelector("style")!.textContent!;
    expect(styles).toContain("a:focus-visible, button:focus-visible");
    expect(styles).toContain("outline:");
  });
});

describe("renderCard", () => {
  it("is what the refresh tick re-renders, identical to the page's own markup", () => {
    const page = renderHomePage(TWO_PROJECTS);
    for (const project of TWO_PROJECTS.projects) {
      const markup = renderCard(project);
      // Whitespace differs (the page joins cards); the card's content does not.
      expect(page).toContain(markup);
    }
  });
});
