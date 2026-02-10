import { h } from "preact";
import { useState, useMemo, useEffect } from "preact/hooks";
import type { LoadedData, NavigateTo, DetailItem } from "../types.js";
import type { FileEntry } from "../../schema/v1.js";
import { ZONE_COLORS } from "../components/constants.js";
import { buildFileToZoneMap } from "../utils.js";
import { BrandedHeader } from "../components/logos.js";

interface FilesViewProps {
  data: LoadedData;
  onSelect: (detail: DetailItem | null) => void;
  selectedFile?: string | null;
  setSelectedFile?: (file: string | null) => void;
  selectedZone?: string | null;
  navigateTo?: NavigateTo;
}

type SortKey = "path" | "size" | "language" | "lineCount" | "role" | "category";
type SortDir = "asc" | "desc";

const ROLE_TAG_CLASS: Record<string, string> = {
  source: "tag-source",
  test: "tag-test",
  config: "tag-config",
  docs: "tag-docs",
  generated: "tag-other",
  asset: "tag-other",
  build: "tag-other",
  other: "tag-other",
};

export function FilesView({ data, onSelect, selectedFile, setSelectedFile, selectedZone, navigateTo }: FilesViewProps) {
  const { inventory, zones } = data;
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [langFilter, setLangFilter] = useState<string>("all");
  const [zoneFilter, setZoneFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("path");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [showCount, setShowCount] = useState(100);

  // Auto-set zone filter when selectedZone prop is provided
  useEffect(() => {
    if (selectedZone) {
      setZoneFilter(selectedZone);
    }
  }, [selectedZone]);

  if (!inventory) {
    return h("div", { class: "loading" }, "No inventory data available.");
  }

  const fileToZone = useMemo(() => buildFileToZoneMap(zones), [zones]);

  // Zone list for dropdown
  const zoneList = useMemo(() => {
    if (!zones) return [];
    return zones.zones.map((z, i) => ({
      id: z.id,
      name: z.name,
      color: ZONE_COLORS[i % ZONE_COLORS.length],
    }));
  }, [zones]);

  const languages = useMemo(
    () => Object.keys(inventory.summary.byLanguage).sort(),
    [inventory]
  );

  const roles = useMemo(
    () => Object.keys(inventory.summary.byRole).sort(),
    [inventory]
  );

  const filtered = useMemo(() => {
    let files = inventory.files;

    if (search) {
      const q = search.toLowerCase();
      files = files.filter(
        (f) =>
          f.path.toLowerCase().includes(q) ||
          f.category.toLowerCase().includes(q)
      );
    }

    if (roleFilter !== "all") {
      files = files.filter((f) => f.role === roleFilter);
    }

    if (langFilter !== "all") {
      files = files.filter((f) => f.language === langFilter);
    }

    if (zoneFilter !== "all") {
      if (zoneFilter === "__unzoned__") {
        files = files.filter((f) => !fileToZone.has(f.path));
      } else {
        files = files.filter((f) => fileToZone.get(f.path)?.id === zoneFilter);
      }
    }

    files = [...files].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      const cmp =
        typeof aVal === "number" && typeof bVal === "number"
          ? aVal - bVal
          : String(aVal).localeCompare(String(bVal));
      return sortDir === "asc" ? cmp : -cmp;
    });

    return files;
  }, [inventory, search, roleFilter, langFilter, zoneFilter, sortKey, sortDir, fileToZone]);

  // Reset show count when filters change
  useMemo(() => setShowCount(100), [search, roleFilter, langFilter, zoneFilter]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sortIndicator = (key: SortKey): string => {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " \u25B2" : " \u25BC";
  };

  const handleRowClick = (file: FileEntry) => {
    if (setSelectedFile) setSelectedFile(file.path);
    onSelect({
      type: "file",
      title: file.path.split("/").pop() || file.path,
      path: file.path,
      language: file.language,
      size: formatSize(file.size),
      lines: file.lineCount,
      role: file.role,
      category: file.category,
      hash: file.hash,
    });
  };

  const visible = filtered.slice(0, showCount);
  const remaining = filtered.length - showCount;

  return h("div", null,
    h("div", { class: "view-header" },
      h(BrandedHeader, { product: "sourcevision", title: "SourceVision", class: "branded-header-sv" }),
      h("h2", { class: "section-header" }, "Files"),
    ),
    h("p", { class: "section-sub" },
      `${inventory.summary.totalFiles} files, ${inventory.summary.totalLines.toLocaleString()} lines`
    ),

    // Filter bar
    h("div", { class: "filter-bar" },
      h("input", {
        class: "filter-input",
        type: "text",
        placeholder: "Search files or categories...",
        value: search,
        onInput: (e: Event) => setSearch((e.target as HTMLInputElement).value),
      }),
      h("select", {
        class: "filter-select",
        value: roleFilter,
        onChange: (e: Event) => setRoleFilter((e.target as HTMLSelectElement).value),
      },
        h("option", { value: "all" }, "All Roles"),
        roles.map((r) => h("option", { key: r, value: r }, r))
      ),
      h("select", {
        class: "filter-select",
        value: langFilter,
        onChange: (e: Event) => setLangFilter((e.target as HTMLSelectElement).value),
      },
        h("option", { value: "all" }, "All Languages"),
        languages.map((l) => h("option", { key: l, value: l }, l))
      ),
      // Zone filter
      zoneList.length > 0
        ? h("select", {
            class: "filter-select",
            value: zoneFilter,
            onChange: (e: Event) => setZoneFilter((e.target as HTMLSelectElement).value),
          },
            h("option", { value: "all" }, "All Zones"),
            zoneList.map((z) => h("option", { key: z.id, value: z.id }, z.name)),
            h("option", { value: "__unzoned__" }, "Unzoned")
          )
        : null,
      h("span", { class: "filter-result-count" },
        `Showing ${Math.min(showCount, filtered.length)} of ${filtered.length} files`
      ),
    ),

    // Table
    h("div", { class: "data-table-wrapper" },
    h("table", { class: "data-table" },
      h("thead", null,
        h("tr", null,
          h("th", { onClick: () => toggleSort("path") }, `Path${sortIndicator("path")}`),
          zoneList.length > 0 ? h("th", null, "Zone") : null,
          h("th", { onClick: () => toggleSort("language") }, `Language${sortIndicator("language")}`),
          h("th", { onClick: () => toggleSort("lineCount") }, `Lines${sortIndicator("lineCount")}`),
          h("th", { onClick: () => toggleSort("size") }, `Size${sortIndicator("size")}`),
          h("th", { onClick: () => toggleSort("role") }, `Role${sortIndicator("role")}`),
          h("th", { onClick: () => toggleSort("category") }, `Category${sortIndicator("category")}`)
        )
      ),
      h("tbody", null,
        visible.map((file) => {
          const fz = fileToZone.get(file.path);
          return h("tr", {
            key: file.path,
            onClick: () => handleRowClick(file),
            style: `cursor: pointer;${selectedFile === file.path ? " background: var(--bg-hover);" : ""}`,
          },
            h("td", { class: "mono-sm" }, file.path),
            zoneList.length > 0
              ? h("td", null,
                  fz
                    ? h("span", { class: "zone-badge", style: `--zone-color: ${fz.color}` },
                        fz.name
                      )
                    : null
                )
              : null,
            h("td", null, file.language),
            h("td", { class: "text-right" }, file.lineCount.toLocaleString()),
            h("td", { class: "text-right" }, formatSize(file.size)),
            h("td", null,
              h("span", { class: `tag ${ROLE_TAG_CLASS[file.role] || "tag-other"}` }, file.role)
            ),
            h("td", null, file.category)
          );
        })
      )
    )),

    remaining > 0
      ? h("div", { class: "empty-state" },
          h("button", {
            class: "collapsible-toggle",
            onClick: () => setShowCount(showCount + 100),
          }, `Show ${Math.min(remaining, 100)} more (${remaining} remaining)`)
        )
      : null
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
