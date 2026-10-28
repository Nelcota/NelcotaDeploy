import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";

export type Theme = "dark" | "light";

const STORAGE_KEY = "nelcota-theme";

/**
 * Inline script for `<head>` that applies the saved theme before the first paint, so the
 * page never flashes the wrong theme. Dark is the default.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("${STORAGE_KEY}");document.documentElement.classList.toggle("dark",t!=="light");}catch(e){document.documentElement.classList.add("dark");}})();`;

type ThemeContextValue = { readonly theme: Theme; readonly toggleTheme: () => void };

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  toggleTheme: () => undefined,
});

/** Provides the current theme and a toggle that persists the choice in the browser. */
export function ThemeProvider({ children }: { readonly children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === "dark" ? "light" : "dark";
      document.documentElement.classList.toggle("dark", next === "dark");
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Private windows may block storage; the theme still applies for this visit.
      }
      return next;
    });
  }, []);

  return <ThemeContext value={{ theme, toggleTheme }}>{children}</ThemeContext>;
}

/** Returns the current theme and a function to switch it. */
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
