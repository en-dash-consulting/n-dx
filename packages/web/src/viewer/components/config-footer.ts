/**
 * Configuration display and project switching footer for the sidebar.
 *
 * Shows active n-dx configuration (model, auth method, token budget) in a
 * collapsible panel above the sidebar footer controls. Provides a dropdown
 * for switching between detected n-dx projects.
 */

import { h } from "preact";
import { useState, useEffect, useRef, useCallback } from "preact/hooks";

// ---------------------------------------------------------------------------
// Types (mirror server-side shapes)
// ---------------------------------------------------------------------------

interface NdxConfigSummary {
  model: string | null;
  provider: string | null;
  authMethod: "api-key" | "cli" | "none";
  tokenBudget: number | null;
  maxTurns: number | null;
  projectDir: string;
  projectName: string;
}

interface DetectedProject {
  path: string;
  name: string;
  active: boolean;
  tools: {
    sourcevision: boolean;
    rex: boolean;
    hench: boolean;
  };
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

const CONFIG_POLL_INTERVAL_MS = 30_000;

function useNdxConfig(): NdxConfigSummary | null {
  const [config, setConfig] = useState<NdxConfigSummary | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const fetchConfig = async () => {
      try {
        const res = await fetch("/api/ndx-config");
        if (!res.ok) return;
        const data: NdxConfigSummary = await res.json();
        if (mountedRef.current) setConfig(data);
      } catch {
        // ignore
      }
    };

    fetchConfig();
    const timer = setInterval(fetchConfig, CONFIG_POLL_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, []);

  return config;
}

function useDetectedProjects(): DetectedProject[] {
  const [projects, setProjects] = useState<DetectedProject[]>([]);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const fetchProjects = async () => {
      try {
        const res = await fetch("/api/projects");
        if (!res.ok) return;
        const data: DetectedProject[] = await res.json();
        if (mountedRef.current) setProjects(data);
      } catch {
        // ignore
      }
    };

    fetchProjects();

    return () => {
      mountedRef.current = false;
    };
  }, []);

  return projects;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatModel(model: string | null): string {
  if (!model) return "default";
  // Shorten full model IDs for display
  if (model.startsWith("claude-")) {
    const parts = model.split("-");
    // "claude-sonnet-4-20250514" -> "sonnet 4"
    if (parts.length >= 3) {
      return `${parts[1]} ${parts[2]}`;
    }
  }
  return model;
}

function formatTokenBudget(budget: number | null): string {
  if (budget === null || budget === 0) return "unlimited";
  if (budget >= 1_000_000) return `${(budget / 1_000_000).toFixed(1)}M`;
  if (budget >= 1_000) return `${Math.round(budget / 1_000)}K`;
  return String(budget);
}

const AUTH_LABELS: Record<string, string> = {
  "api-key": "API Key",
  "cli": "Claude CLI",
  "none": "Not configured",
};

const AUTH_ICONS: Record<string, string> = {
  "api-key": "\u{1F511}",
  "cli": "\u{1F4BB}",
  "none": "\u26A0",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ConfigFooterProps {
  /** Called when the user switches projects. */
  onProjectSwitch?: (projectPath: string) => void;
}

export function ConfigFooter({ onProjectSwitch }: ConfigFooterProps) {
  const config = useNdxConfig();
  const projects = useDetectedProjects();
  const [expanded, setExpanded] = useState(false);
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!projectDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setProjectDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [projectDropdownOpen]);

  // Close dropdown on Escape
  useEffect(() => {
    if (!projectDropdownOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setProjectDropdownOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [projectDropdownOpen]);

  const handleProjectSelect = useCallback((projectPath: string) => {
    setProjectDropdownOpen(false);
    if (onProjectSwitch) {
      onProjectSwitch(projectPath);
    }
  }, [onProjectSwitch]);

  if (!config) return null;

  const hasMultipleProjects = projects.length > 1;

  return h("div", {
    class: `config-footer${expanded ? " config-footer-expanded" : ""}`,
    role: "region",
    "aria-label": "Project configuration",
  },
    // Toggle bar — always visible
    h("button", {
      class: "config-footer-toggle",
      onClick: () => setExpanded(!expanded),
      "aria-expanded": String(expanded),
      "aria-controls": "config-footer-details",
      title: expanded ? "Collapse configuration" : "Show configuration",
    },
      h("span", { class: "config-footer-summary" },
        // Model badge
        h("span", {
          class: "config-badge config-badge-model",
          title: `Model: ${config.model ?? "default"}`,
        }, formatModel(config.model)),
        // Auth indicator
        h("span", {
          class: `config-badge config-badge-auth config-badge-auth-${config.authMethod}`,
          title: `Auth: ${AUTH_LABELS[config.authMethod]}`,
        }, AUTH_ICONS[config.authMethod]),
      ),
      h("svg", {
        class: `config-footer-chevron${expanded ? " config-footer-chevron-open" : ""}`,
        width: 10,
        height: 10,
        viewBox: "0 0 12 12",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "1.5",
        "stroke-linecap": "round",
        "aria-hidden": "true",
      }, h("path", { d: "M3 8.5l3-3 3 3" })),
    ),

    // Expandable detail panel
    expanded
      ? h("div", {
          id: "config-footer-details",
          class: "config-footer-details",
          role: "group",
          "aria-label": "Configuration details",
        },
          // Config rows
          h("div", { class: "config-row" },
            h("span", { class: "config-label" }, "Model"),
            h("span", { class: "config-value" }, formatModel(config.model)),
          ),
          h("div", { class: "config-row" },
            h("span", { class: "config-label" }, "Auth"),
            h("span", { class: "config-value" }, AUTH_LABELS[config.authMethod]),
          ),
          config.provider
            ? h("div", { class: "config-row" },
                h("span", { class: "config-label" }, "Provider"),
                h("span", { class: "config-value" }, config.provider),
              )
            : null,
          h("div", { class: "config-row" },
            h("span", { class: "config-label" }, "Budget"),
            h("span", { class: "config-value" }, formatTokenBudget(config.tokenBudget)),
          ),
          config.maxTurns
            ? h("div", { class: "config-row" },
                h("span", { class: "config-label" }, "Max turns"),
                h("span", { class: "config-value" }, String(config.maxTurns)),
              )
            : null,

          // Project switcher (only if multiple projects detected)
          hasMultipleProjects
            ? h("div", {
                class: "config-project-switcher",
                ref: dropdownRef,
              },
                h("div", { class: "config-footer-divider", "aria-hidden": "true" }),
                h("button", {
                  class: "config-project-btn",
                  onClick: () => setProjectDropdownOpen(!projectDropdownOpen),
                  "aria-expanded": String(projectDropdownOpen),
                  "aria-haspopup": "listbox",
                  title: `Current project: ${config.projectName}`,
                },
                  h("span", { class: "config-project-name" }, config.projectName),
                  h("svg", {
                    class: `config-project-chevron${projectDropdownOpen ? " config-project-chevron-open" : ""}`,
                    width: 10,
                    height: 10,
                    viewBox: "0 0 12 12",
                    fill: "none",
                    stroke: "currentColor",
                    "stroke-width": "1.5",
                    "stroke-linecap": "round",
                    "aria-hidden": "true",
                  }, h("path", { d: "M3 4.5l3 3 3-3" })),
                ),
                projectDropdownOpen
                  ? h("div", {
                      class: "config-project-dropdown",
                      role: "listbox",
                      "aria-label": "Select project",
                    },
                      projects.map((project) =>
                        h("button", {
                          key: project.path,
                          class: `config-project-option${project.active ? " config-project-option-active" : ""}`,
                          role: "option",
                          "aria-selected": String(project.active),
                          onClick: () => project.active ? setProjectDropdownOpen(false) : handleProjectSelect(project.path),
                          title: project.path,
                        },
                          h("span", { class: "config-project-option-name" }, project.name),
                          h("span", { class: "config-project-option-tools" },
                            project.tools.sourcevision ? h("span", { class: "config-tool-dot config-tool-sv", title: "SourceVision" }) : null,
                            project.tools.rex ? h("span", { class: "config-tool-dot config-tool-rex", title: "Rex" }) : null,
                            project.tools.hench ? h("span", { class: "config-tool-dot config-tool-hench", title: "Hench" }) : null,
                          ),
                          project.active
                            ? h("span", { class: "config-project-active-marker", "aria-label": "Active" }, "\u2713")
                            : null,
                        )
                      ),
                    )
                  : null,
              )
            : null,
        )
      : null,
  );
}
