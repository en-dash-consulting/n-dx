/**
 * Simple toast notification state hook.
 *
 * Manages a single toast message with configurable type (success/error)
 * and auto-dismiss duration. Extracted from PRDView to enable reuse
 * across views that need lightweight user feedback.
 */

import { useState, useCallback } from "preact/hooks";

export type ToastType = "success" | "error";

export interface ToastState {
  /** Currently visible toast message, or null when hidden. */
  toast: string | null;
  /** Visual variant — green for success, red for error. */
  toastType: ToastType;
  /** Show a toast that auto-dismisses after `duration` ms (default 3000). */
  showToast: (message: string, type?: ToastType, duration?: number) => void;
}

/**
 * Hook providing toast notification state and display logic.
 *
 * Returns a stable `showToast` callback that sets the message, type,
 * and schedules auto-dismissal. Only one toast is visible at a time —
 * calling `showToast` again replaces the current toast.
 */
export function useToast(): ToastState {
  const [toast, setToast] = useState<string | null>(null);
  const [toastType, setToastType] = useState<ToastType>("success");

  const showToast = useCallback(
    (message: string, type: ToastType = "success", duration = 3000) => {
      setToast(message);
      setToastType(type);
      setTimeout(() => setToast(null), duration);
    },
    [],
  );

  return { toast, toastType, showToast };
}
