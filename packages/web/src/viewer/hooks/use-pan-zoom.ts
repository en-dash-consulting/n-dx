/**
 * usePanZoom — SVG viewport panning and zooming hook.
 *
 * Handles:
 * - Trackpad/mouse wheel scrolling (pan) and pinch-to-zoom (ctrl+wheel)
 * - Mouse-drag panning on the SVG background
 * - Programmatic zoom-in, zoom-out, and fit-to-content controls
 */

import { useState, useCallback, useRef, useEffect, useLayoutEffect } from "preact/hooks";
import type { RefObject } from "preact";

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PanZoomState {
  viewBox: ViewBox;
  panning: boolean;
  svgRef: RefObject<SVGSVGElement>;
  handleWheel: (e: WheelEvent) => void;
  startPan: (e: MouseEvent) => void;
  movePan: (e: MouseEvent) => void;
  endPan: () => void;
  handleZoomIn: () => void;
  handleZoomOut: () => void;
  handleFit: () => void;
  /**
   * Translate the viewport so `point` (in SVG user-space coords) sits at the
   * center. Zoom level is preserved — only x/y of the viewBox change.
   */
  recenter: (point: { x: number; y: number }) => void;
}

/**
 * Hook that manages SVG pan/zoom state and interaction handlers.
 *
 * @param fitVB - The "fit to content" viewBox dimensions
 */
export function usePanZoom(fitVB: ViewBox): PanZoomState {
  const svgRef = useRef<SVGSVGElement>(null);
  const [panning, setPanning] = useState(false);
  const panStart = useRef<{ x: number; y: number; vbx: number; vby: number } | null>(null);
  const [viewBox, setViewBox] = useState<ViewBox>(fitVB);

  // Auto-fit when the underlying graph content meaningfully shifts. The
  // caller produces a fresh `fitVB` object on most renders (memo deps churn,
  // unrelated state updates), so reference equality alone would clobber any
  // user pan, zoom, or recenter on every commit. Compare by value to detect
  // genuine bound changes only.
  //
  // useLayoutEffect (vs useEffect) runs synchronously after commit, so the
  // initial fit lands BEFORE a click event interleaved by a test or fast
  // user can fire `recenter`. With deferred useEffect, `recenter` would
  // sometimes run on the previous fit, then get overwritten by the
  // post-commit auto-fit.
  const lastFitVBRef = useRef<ViewBox | null>(null);
  useLayoutEffect(() => {
    const prev = lastFitVBRef.current;
    if (
      prev !== null &&
      prev.x === fitVB.x &&
      prev.y === fitVB.y &&
      prev.w === fitVB.w &&
      prev.h === fitVB.h
    ) {
      return;
    }
    lastFitVBRef.current = fitVB;
    setViewBox(fitVB);
  }, [fitVB]);

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();

    // ctrlKey = pinch-zoom on trackpad (or ctrl+scroll on mouse) → zoom
    if (e.ctrlKey) {
      const fx = (e.clientX - rect.left) / rect.width;
      const fy = (e.clientY - rect.top) / rect.height;
      // Clamp deltaY to reduce sensitivity: ±2px max effect per event
      const clamped = Math.max(-2, Math.min(2, e.deltaY));
      const zoomFactor = 1 + clamped * 0.02;

      setViewBox((vb) => {
        const newW = vb.w * zoomFactor;
        const newH = vb.h * zoomFactor;
        const newX = vb.x + (vb.w - newW) * fx;
        const newY = vb.y + (vb.h - newH) * fy;
        return { x: newX, y: newY, w: newW, h: newH };
      });
      return;
    }

    // Regular scroll / two-finger drag on trackpad → pan
    setViewBox((vb) => {
      const scaleX = vb.w / rect.width;
      const scaleY = vb.h / rect.height;
      return {
        ...vb,
        x: vb.x + e.deltaX * scaleX,
        y: vb.y + e.deltaY * scaleY,
      };
    });
  }, []);

  const startPan = useCallback((e: MouseEvent) => {
    setPanning(true);
    panStart.current = { x: e.clientX, y: e.clientY, vbx: viewBox.x, vby: viewBox.y };
  }, [viewBox]);

  const movePan = useCallback((e: MouseEvent) => {
    if (!panning || !panStart.current || !svgRef.current) return;

    const rect = svgRef.current.getBoundingClientRect();
    const scaleX = viewBox.w / rect.width;
    const scaleY = viewBox.h / rect.height;

    const dx = (e.clientX - panStart.current.x) * scaleX;
    const dy = (e.clientY - panStart.current.y) * scaleY;

    setViewBox((vb) => ({
      ...vb,
      x: panStart.current!.vbx - dx,
      y: panStart.current!.vby - dy,
    }));
  }, [panning, viewBox.w, viewBox.h]);

  const endPan = useCallback(() => {
    setPanning(false);
    panStart.current = null;
  }, []);

  const handleZoomIn = useCallback(() => {
    setViewBox((vb) => ({
      x: vb.x + vb.w * 0.1,
      y: vb.y + vb.h * 0.1,
      w: vb.w * 0.8,
      h: vb.h * 0.8,
    }));
  }, []);

  const handleZoomOut = useCallback(() => {
    setViewBox((vb) => ({
      x: vb.x - vb.w * 0.125,
      y: vb.y - vb.h * 0.125,
      w: vb.w * 1.25,
      h: vb.h * 1.25,
    }));
  }, []);

  const handleFit = useCallback(() => {
    setViewBox(fitVB);
  }, [fitVB]);

  const recenter = useCallback((point: { x: number; y: number }) => {
    setViewBox((vb) => ({
      ...vb,
      x: point.x - vb.w / 2,
      y: point.y - vb.h / 2,
    }));
  }, []);

  return {
    viewBox,
    panning,
    svgRef,
    handleWheel,
    startPan,
    movePan,
    endPan,
    handleZoomIn,
    handleZoomOut,
    handleFit,
    recenter,
  };
}
