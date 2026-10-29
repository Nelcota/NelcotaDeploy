// Applies the saved theme before the first paint, so the page never flashes the wrong theme.
// Dark is the default. The storage key must match STORAGE_KEY in
// src/web/components/shell/theme.tsx.
(function applySavedTheme() {
  try {
    const savedTheme = localStorage.getItem("nelcota-theme");
    document.documentElement.classList.toggle("dark", savedTheme !== "light");
  } catch {
    // Private windows may block storage; fall back to the default dark theme.
    document.documentElement.classList.add("dark");
  }
})();
