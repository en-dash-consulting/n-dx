import { h, render, Fragment } from "preact";
import type { VNode } from "preact";
import { useState, useEffect, useCallback } from "preact/hooks";
import type { LoadedData, ViewId, NavigateTo, DetailItem } from "./types.js";
import { loadFromServer, loadFromFiles, detectMode, onDataChange, startPolling, stopPolling } from "./loader.js";
import { ALL_DATA_FILES } from "../schema/data-files.js";
import { Sidebar } from "./components/sidebar.js";
import { DetailPanel } from "./components/detail-panel.js";
import { Guide } from "./components/guide.js";
import { ThemeToggle, initTheme } from "./components/theme-toggle.js";
import { Overview } from "./views/overview.js";
import { Graph } from "./views/graph.js";
import { ZonesView } from "./views/zones.js";
import { FilesView } from "./views/files.js";
import { ArchitectureView } from "./views/architecture.js";
import { ProblemsView } from "./views/problems.js";
import { SuggestionsView } from "./views/suggestions.js";
import { RoutesView } from "./views/routes.js";
import { PRDView } from "./views/prd.js";

initTheme();

const VALID_VIEWS = new Set<ViewId>(["overview", "graph", "zones", "files", "routes", "architecture", "problems", "suggestions", "prd"]);

function getInitialView(): ViewId {
  const hash = location.hash.replace("#", "") as ViewId;
  return VALID_VIEWS.has(hash) ? hash : "overview";
}

function App() {
  const [view, setView] = useState<ViewId>(getInitialView);
  const [data, setData] = useState<LoadedData>({
    manifest: null,
    inventory: null,
    imports: null,
    zones: null,
    components: null,
  });
  const [detail, setDetail] = useState<DetailItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDrop, setShowDrop] = useState(false);
  const [mode, setMode] = useState<"server" | "static">("static");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [refreshToast, setRefreshToast] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [prdDetailContent, setPrdDetailContent] = useState<VNode<any> | null>(null);

  const navigateTo: NavigateTo = useCallback((targetView, opts) => {
    const file = opts?.file ?? null;
    const zone = opts?.zone ?? null;
    setSelectedFile(file);
    setSelectedZone(zone);
    setView(targetView);
    history.pushState({ view: targetView, file, zone }, "", `#${targetView}`);
  }, []);

  const handleSidebarNav = useCallback((id: ViewId) => {
    setSelectedFile(null);
    setSelectedZone(null);
    setView(id);
    history.pushState({ view: id, file: null, zone: null }, "", `#${id}`);
  }, []);

  // Scroll to top on view change
  useEffect(() => {
    document.getElementById("main-content")?.scrollTo(0, 0);
  }, [view]);

  useEffect(() => {
    // Seed the initial history entry
    history.replaceState({ view, file: selectedFile, zone: selectedZone }, "", `#${view}`);

    const handlePopState = (e: PopStateEvent) => {
      if (e.state) {
        const s = e.state as { view?: string; file?: string | null; zone?: string | null };
        if (s.view && VALID_VIEWS.has(s.view as ViewId)) {
          setView(s.view as ViewId);
          setSelectedFile(s.file ?? null);
          setSelectedZone(s.zone ?? null);
        }
      }
    };
    window.addEventListener("popstate", handlePopState);

    let initialLoad = true;
    onDataChange((newData) => {
      setData(newData);
      if (!initialLoad) {
        setRefreshToast(true);
        setTimeout(() => setRefreshToast(false), 3000);
      }
    });

    detectMode().then(async (m) => {
      setMode(m);
      if (m === "server") {
        await loadFromServer();
        setLoading(false);
        initialLoad = false;
        startPolling(5000);
      } else {
        setLoading(false);
        setShowDrop(true);
      }
    });

    return () => {
      stopPolling();
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  // Drag and drop
  useEffect(() => {
    if (mode === "server") return;

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      setShowDrop(true);
    };

    const handleDrop = async (e: DragEvent) => {
      e.preventDefault();
      setShowDrop(false);
      if (e.dataTransfer?.files) {
        setLoading(true);
        await loadFromFiles(e.dataTransfer.files);
        setLoading(false);
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) setShowDrop(false);
    };

    document.addEventListener("dragover", handleDragOver);
    document.addEventListener("drop", handleDrop);
    document.addEventListener("dragleave", handleDragLeave);

    return () => {
      document.removeEventListener("dragover", handleDragOver);
      document.removeEventListener("drop", handleDrop);
      document.removeEventListener("dragleave", handleDragLeave);
    };
  }, [mode]);

  const hasData = data.manifest || data.inventory || data.imports || data.zones;

  const renderView = () => {
    if (loading) {
      return h("div", { class: "loading" }, "Loading...");
    }

    switch (view) {
      case "overview":
        return h(Overview, { data });
      case "graph":
        return h(Graph, { data, onSelect: setDetail, selectedFile, selectedZone });
      case "zones":
        return h(ZonesView, { data, onSelect: setDetail, setSelectedZone, navigateTo });
      case "files":
        return h(FilesView, { data, onSelect: setDetail, selectedFile, setSelectedFile, selectedZone, navigateTo });
      case "routes":
        return h(RoutesView, { data });
      case "architecture":
        return h(ArchitectureView, { data, onSelect: setDetail, navigateTo });
      case "problems":
        return h(ProblemsView, { data });
      case "suggestions":
        return h(SuggestionsView, { data });
      case "prd":
        return h(PRDView, { onSelectItem: setDetail, onDetailContent: setPrdDetailContent });
      default:
        return null;
    }
  };

  return h(Fragment, null,
    h("a", { href: "#main-content", class: "skip-link" }, "Skip to main content"),
    h(Sidebar, { view, onNavigate: handleSidebarNav, manifest: data.manifest, zones: data.zones }),
    h("main", {
      id: "main-content",
      class: "main",
      role: "main",
      "aria-label": "Main content",
    },
      h("div", { class: "header-buttons-wrapper" },
        h("div", { class: "header-buttons" },
          h(ThemeToggle, null),
          h(Guide, { view }),
        ),
      ),
      renderView()
    ),
    h(DetailPanel, { detail, data, navigateTo, onClose: () => { setDetail(null); setPrdDetailContent(null); }, prdDetailContent }),
    refreshToast
      ? h("div", { class: "refresh-toast", role: "status" }, "Data updated")
      : null,
    (showDrop && !hasData)
      ? h("div", { class: "drop-overlay", role: "dialog", "aria-label": "File drop zone" },
          h("div", { class: "drop-box" },
            h("h2", null, "Drop .sourcevision files"),
            h("p", null, `Drag and drop ${ALL_DATA_FILES.join(", ")}`)
          )
        )
      : null
  );
}

const root = document.getElementById("app");
if (root) {
  render(h(App, null), root);
}
