/**
 * Landing page interactions — theme toggle and copy-to-clipboard.
 * Vanilla JS (no framework dependency).
 */

// ── Theme toggle ──
const themeBtn = document.getElementById("theme-toggle");
if (themeBtn) {
  themeBtn.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") || "dark";
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("sv-theme", next);
    themeBtn.setAttribute(
      "aria-label",
      next === "dark" ? "Switch to light mode" : "Switch to dark mode",
    );
  });
}

// ── Copy install command ──
const copyBtn = document.getElementById("copy-btn");
const installCode = document.getElementById("install-code");
if (copyBtn && installCode) {
  copyBtn.addEventListener("click", async () => {
    const text = installCode.textContent || "";
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.setAttribute("data-copied", "true");
      copyBtn.setAttribute("aria-label", "Copied!");
      setTimeout(() => {
        copyBtn.removeAttribute("data-copied");
        copyBtn.setAttribute("aria-label", "Copy install command");
      }, 2000);
    } catch {
      // Fallback for older browsers
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      copyBtn.setAttribute("data-copied", "true");
      setTimeout(() => copyBtn.removeAttribute("data-copied"), 2000);
    }
  });
}

// ── Smooth scroll for anchor links (polyfill for Safari) ──
document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
  anchor.addEventListener("click", (e) => {
    const href = (anchor as HTMLAnchorElement).getAttribute("href");
    if (!href || href === "#") return;
    const target = document.querySelector(href);
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      // Update URL without scroll jump
      history.pushState(null, "", href);
    }
  });
});
