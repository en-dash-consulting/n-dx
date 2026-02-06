import { h } from "preact";

/**
 * Health Gauge - A radial progress indicator for metrics like cohesion/coupling.
 * Shows a value from 0-1 with color coding (green=good, orange=warning, red=bad).
 */

interface HealthGaugeProps {
  value: number; // 0-1
  label: string;
  size?: number;
  inverted?: boolean; // If true, lower is better (e.g., coupling)
}

export function HealthGauge({ value, label, size = 80, inverted = false }: HealthGaugeProps) {
  const normalized = Math.max(0, Math.min(1, value));
  const displayValue = inverted ? 1 - normalized : normalized;

  // Color based on health (green=good, orange=mid, red=bad)
  const color = displayValue >= 0.7 ? "var(--green)"
    : displayValue >= 0.4 ? "var(--orange)"
    : "var(--red)";

  // SVG arc parameters
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = normalized * circumference;
  const cx = size / 2;
  const cy = size / 2;

  return h("div", { class: "health-gauge", style: `width: ${size}px` },
    h("svg", {
      viewBox: `0 0 ${size} ${size}`,
      width: size,
      height: size,
    },
      // Background circle
      h("circle", {
        cx,
        cy,
        r: radius,
        fill: "none",
        stroke: "var(--border)",
        "stroke-width": strokeWidth,
      }),
      // Progress arc
      h("circle", {
        cx,
        cy,
        r: radius,
        fill: "none",
        stroke: color,
        "stroke-width": strokeWidth,
        "stroke-linecap": "round",
        "stroke-dasharray": `${progress} ${circumference}`,
        "stroke-dashoffset": 0,
        transform: `rotate(-90 ${cx} ${cy})`,
        style: "transition: stroke-dasharray 0.3s ease",
      }),
      // Center text
      h("text", {
        x: cx,
        y: cy,
        "text-anchor": "middle",
        "dominant-baseline": "central",
        class: "health-gauge-value",
        fill: color,
      }, normalized.toFixed(2)),
    ),
    h("div", { class: "health-gauge-label" }, label)
  );
}

/**
 * Health Badge - A compact inline indicator for health status.
 */
interface HealthBadgeProps {
  value: number;
  inverted?: boolean;
}

export function HealthBadge({ value, inverted = false }: HealthBadgeProps) {
  const normalized = Math.max(0, Math.min(1, value));
  const displayValue = inverted ? 1 - normalized : normalized;

  const level = displayValue >= 0.7 ? "good"
    : displayValue >= 0.4 ? "mid"
    : "bad";

  return h("span", { class: `health-badge health-${level}` },
    normalized.toFixed(2)
  );
}

/**
 * Pattern Badge - Shows a pattern or antipattern indicator.
 */
interface PatternBadgeProps {
  type: "pattern" | "antipattern";
  label: string;
}

export function PatternBadge({ type, label }: PatternBadgeProps) {
  const icon = type === "pattern" ? "\u2713" : "\u26A0";
  return h("span", { class: `pattern-badge ${type}` },
    h("span", { class: "pattern-icon" }, icon),
    label
  );
}

/**
 * Metric Card - A card displaying a single metric with visual indicator.
 */
interface MetricCardProps {
  value: string | number;
  label: string;
  trend?: "up" | "down" | "neutral";
  color?: string;
}

export function MetricCard({ value, label, trend, color }: MetricCardProps) {
  const trendIcon = trend === "up" ? "\u2191" : trend === "down" ? "\u2193" : "";

  return h("div", { class: "metric-card" },
    h("div", { class: "metric-value", style: color ? `color: ${color}` : "" },
      value,
      trend ? h("span", { class: `metric-trend metric-trend-${trend}` }, trendIcon) : null
    ),
    h("div", { class: "metric-label" }, label)
  );
}
