import { h } from "preact";

// --- BarChart ---

interface BarChartItem {
  label: string;
  value: number;
  color?: string;
}

interface BarChartProps {
  data: BarChartItem[];
  width?: number;
  height?: number;
}

export function BarChart({ data, width = 500, height }: BarChartProps) {
  if (data.length === 0) return null;

  const barHeight = 22;
  const gap = 4;
  const labelWidth = 150;
  const valueWidth = 50;
  const chartHeight = height ?? data.length * (barHeight + gap);
  const barArea = width - labelWidth - valueWidth - 16;
  const maxVal = Math.max(...data.map((d) => d.value), 1);

  return h("svg", {
    viewBox: `0 0 ${width} ${chartHeight}`,
    class: "chart-block",
    preserveAspectRatio: "xMinYMin meet",
  },
    data.map((d, i) => {
      const y = i * (barHeight + gap);
      const barW = Math.max((d.value / maxVal) * barArea, 2);

      return h("g", { key: d.label },
        // Label
        h("text", {
          x: labelWidth - 8,
          y: y + barHeight / 2 + 4,
          "text-anchor": "end",
          class: "bar-chart-label",
        }, truncateLabel(d.label)),
        // Bar
        h("rect", {
          x: labelWidth,
          y: y + 2,
          width: barW,
          height: barHeight - 4,
          rx: 3,
          fill: d.color || "var(--accent)",
          opacity: 0.85,
        }),
        // Value
        h("text", {
          x: labelWidth + barW + 6,
          y: y + barHeight / 2 + 4,
          class: "bar-chart-value",
        }, String(d.value)),
      );
    })
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "\u2026" : s;
}

function truncateLabel(s: string): string {
  return s.length > 22 ? s.slice(0, 21) + "\u2026" : s;
}

// --- FlowDiagram ---

interface FlowNode {
  id: string;
  label: string;
  color: string;
}

interface FlowEdge {
  from: string;
  to: string;
  weight: number;
}

interface FlowDiagramProps {
  nodes: FlowNode[];
  edges: FlowEdge[];
  width?: number;
  height?: number;
  onNodeClick?: (id: string) => void;
}

export function FlowDiagram({
  nodes,
  edges,
  onNodeClick,
}: FlowDiagramProps) {
  if (nodes.length === 0) return null;

  // Responsive sizing via viewBox
  const intrinsicW = 700;
  const intrinsicH = Math.max(400, 200 + nodes.length * 30);
  const cx = intrinsicW / 2;
  const cy = intrinsicH / 2;
  const radius = Math.min(cx, cy) - 60;
  const nodeRadius = 22;
  const labelTruncLen = nodes.length <= 6 ? Infinity : 20;

  // Position nodes in a circle
  const positions = new Map<string, { x: number; y: number }>();
  nodes.forEach((n, i) => {
    const angle = (2 * Math.PI * i) / nodes.length - Math.PI / 2;
    positions.set(n.id, {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    });
  });

  const maxWeight = Math.max(...edges.map((e) => e.weight), 1);

  return h("div", { class: "flow-diagram" },
    h("svg", {
      viewBox: `0 0 ${intrinsicW} ${intrinsicH}`,
      preserveAspectRatio: "xMidYMid meet",
      class: "chart-block",
      style: "max-width: 800px; margin: 0 auto 16px;",
    },
      // Edges
      edges.map((e, i) => {
        const from = positions.get(e.from);
        const to = positions.get(e.to);
        if (!from || !to) return null;

        const sw = Math.max(1, (e.weight / maxWeight) * 4);
        const opacity = 0.3 + (e.weight / maxWeight) * 0.5;
        const isHigh = e.weight / maxWeight > 0.5;

        // Curved path via control point offset from midpoint
        const mx = (from.x + to.x) / 2;
        const my = (from.y + to.y) / 2;
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const offset = Math.min(30, Math.sqrt(dx * dx + dy * dy) * 0.15);
        const cpx = mx - (dy / Math.sqrt(dx * dx + dy * dy + 1)) * offset;
        const cpy = my + (dx / Math.sqrt(dx * dx + dy * dy + 1)) * offset;

        return h("path", {
          key: `edge-${i}`,
          class: "flow-edge",
          d: `M ${from.x} ${from.y} Q ${cpx} ${cpy} ${to.x} ${to.y}`,
          stroke: isHigh ? "var(--orange)" : "var(--border)",
          "stroke-width": sw,
          opacity,
        });
      }),
      // Nodes
      nodes.map((n) => {
        const pos = positions.get(n.id)!;
        return h("g", {
          key: n.id,
          class: "flow-node",
          transform: `translate(${pos.x},${pos.y})`,
          onClick: onNodeClick ? () => onNodeClick(n.id) : undefined,
        },
          h("circle", {
            r: nodeRadius,
            fill: n.color,
            stroke: n.color,
            "stroke-width": 2,
            opacity: 0.8,
          }),
          h("text", {
            y: nodeRadius + 16,
            "text-anchor": "middle",
          }, truncate(n.label, labelTruncLen)),
        );
      }),
    )
  );
}
