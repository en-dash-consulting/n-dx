import { h, Fragment } from "preact";
import { useState, useEffect, useCallback } from "preact/hooks";

interface FAQItem {
  question: string;
  answer: string;
  docLink?: { label: string; hash: string };
}

interface FAQSection {
  title: string;
  items: FAQItem[];
}

const FAQ_SECTIONS: FAQSection[] = [
  {
    title: "Getting Started",
    items: [
      {
        question: "How do I set up n-dx for a new project?",
        answer:
          "Run 'ndx init .' in your project root. This initializes SourceVision (static analysis), Rex (PRD management), and Hench (autonomous agent) directories.",
        docLink: { label: "Overview", hash: "overview" },
      },
      {
        question: "What does 'ndx plan' do?",
        answer:
          "It runs SourceVision analysis on your codebase and feeds the results into Rex, which proposes epics, features, and tasks for your PRD. Use 'ndx plan --accept' to add proposals to your PRD.",
      },
      {
        question: "How do I execute tasks autonomously?",
        answer:
          "Run 'ndx work .' to let Hench pick the next Rex task, build a brief, and execute it using Claude in a tool-use loop. You can target a specific task with '--task=ID'.",
      },
    ],
  },
  {
    title: "SourceVision",
    items: [
      {
        question: "What are zones and how are they detected?",
        answer:
          "Zones are architectural areas detected by Louvain community detection on the import graph. Files with strong internal connections cluster into zones. Low cohesion (<0.4) suggests a zone should be split; high coupling (>0.6) suggests merging.",
        docLink: { label: "Zones view", hash: "zones" },
      },
      {
        question: "What are enrichment passes?",
        answer:
          "SourceVision runs multiple analysis passes. Pass 1 covers inventory, imports, zones, and components. Passes 2-4 add AI-generated architecture insights, problem detection, and suggestions. Run additional 'sourcevision analyze' passes for deeper analysis.",
      },
      {
        question: "What does the import graph show?",
        answer:
          "A force-directed visualization where nodes are files colored by zone. Orange cross-zone edges highlight potential boundary violations. Dense clusters suggest tight coupling; isolated nodes may be dead code.",
        docLink: { label: "Import Graph", hash: "graph" },
      },
    ],
  },
  {
    title: "Rex (PRD Management)",
    items: [
      {
        question: "How is the PRD structured?",
        answer:
          "The PRD is a tree: epics contain features, features contain tasks, and tasks can have subtasks. Each item has a status (pending, in_progress, completed, deferred, blocked, deleted), priority, and optional acceptance criteria.",
        docLink: { label: "Tasks view", hash: "prd" },
      },
      {
        question: "How does Rex determine the next task?",
        answer:
          "Rex considers priority (critical > high > medium > low), dependency blocking (items with unresolved blockers are skipped), and tree position (earlier items in the tree are preferred).",
        docLink: { label: "Rex Dashboard", hash: "rex-dashboard" },
      },
      {
        question: "Can I sync my PRD with Notion?",
        answer:
          "Yes. Configure a Notion adapter, then run 'ndx sync .' to bidirectionally sync your local PRD with a Notion database. Use '--push' or '--pull' for one-way sync.",
      },
    ],
  },
  {
    title: "Hench (Autonomous Agent)",
    items: [
      {
        question: "What happens during an autonomous run?",
        answer:
          "Hench picks the next Rex task, generates a detailed brief with context from SourceVision and Rex, then calls Claude in a tool-use loop. It reads files, writes code, runs tests, and commits changes. Runs are recorded in .hench/runs/.",
        docLink: { label: "Hench Runs", hash: "hench-runs" },
      },
      {
        question: "How do I monitor agent progress?",
        answer:
          "Use 'ndx status .' to check PRD completion. The Hench Runs view in this dashboard shows run history, transcripts, and token usage for each autonomous execution.",
        docLink: { label: "Token Usage", hash: "token-usage" },
      },
      {
        question: "Can I limit which tasks Hench works on?",
        answer:
          "Yes. Use 'ndx work --task=ID' to target a specific task. You can also use '--dry-run' to see what Hench would do without executing. Configure model and max turns in .hench/config.json.",
      },
    ],
  },
  {
    title: "Dashboard",
    items: [
      {
        question: "How do I switch between light and dark mode?",
        answer:
          "Use the theme toggle (sun/moon icon) in the sidebar footer. Your preference is saved automatically and persists across sessions.",
      },
      {
        question: "What do the locked navigation items mean?",
        answer:
          "Items marked with P2, P3, or P4 badges require additional SourceVision enrichment passes. Run more 'sourcevision analyze' passes to unlock Architecture, Problems, and Suggestions views.",
      },
      {
        question: "Can I run the dashboard in the background?",
        answer:
          "Yes. Run 'ndx web --background .' to start the dashboard as a daemon. Use 'ndx web stop' to stop it and 'ndx web status' to check if it's running.",
      },
    ],
  },
];

export function FAQ() {
  const [open, setOpen] = useState(false);
  const [expandedSection, setExpandedSection] = useState<string | null>(FAQ_SECTIONS[0].title);

  const toggleSection = useCallback((title: string) => {
    setExpandedSection((prev) => (prev === title ? null : title));
  }, []);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  return h(Fragment, null,
    h("button", {
      class: "sidebar-control-btn",
      onClick: () => setOpen(true),
      title: "Help & FAQ",
      "aria-label": "Open help and FAQ",
    }, "?"),
    open
      ? h("div", {
          class: "faq-overlay",
          onClick: () => setOpen(false),
          role: "dialog",
          "aria-label": "Help and FAQ",
          "aria-modal": "true",
        },
          h("div", {
            class: "faq-modal",
            onClick: (e: Event) => e.stopPropagation(),
          },
            h("div", { class: "faq-header" },
              h("h2", null, "Help & FAQ"),
              h("button", {
                class: "faq-close",
                onClick: () => setOpen(false),
                "aria-label": "Close FAQ",
              }, "\u2715"),
            ),
            h("div", { class: "faq-body" },
              FAQ_SECTIONS.map((section) => {
                const isExpanded = expandedSection === section.title;
                return h("div", { key: section.title, class: "faq-section" },
                  h("div", {
                    class: "faq-section-header",
                    role: "button",
                    tabIndex: 0,
                    "aria-expanded": String(isExpanded),
                    onClick: () => toggleSection(section.title),
                    onKeyDown: (e: KeyboardEvent) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleSection(section.title);
                      }
                    },
                  },
                    h("span", {
                      class: `faq-section-chevron${isExpanded ? " faq-section-chevron-open" : ""}`,
                      "aria-hidden": "true",
                    }, "\u25B8"),
                    h("span", null, section.title),
                  ),
                  isExpanded
                    ? h("div", { class: "faq-section-items" },
                        section.items.map((item, i) =>
                          h("div", { key: i, class: "faq-item" },
                            h("div", { class: "faq-question" }, item.question),
                            h("div", { class: "faq-answer" }, item.answer),
                            item.docLink
                              ? h("a", {
                                  class: "faq-doc-link",
                                  href: `#${item.docLink.hash}`,
                                  onClick: () => setOpen(false),
                                }, `\u2192 ${item.docLink.label}`)
                              : null,
                          )
                        ),
                      )
                    : null,
                );
              }),
            ),
            h("div", { class: "faq-footer" },
              h("p", null,
                "For CLI reference, run ",
                h("code", null, "ndx --help"),
                " or ",
                h("code", null, "ndx <command> --help"),
              ),
            ),
          ),
        )
      : null,
  );
}
