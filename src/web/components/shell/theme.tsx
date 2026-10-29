import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useSyncExternalStore,
} from "react";

export type Theme = "dark" | "light";

// Must match the key read by public/theme-init.js, which applies the theme before paint.
const STORAGE_KEY = "nelcota-theme";

type ThemeContextValue = { readonly theme: Theme; readonly toggleTheme: () => void };

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  toggleTheme: () => undefined,
});

function readDocumentTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/** The server cannot see the saved choice, so it renders the default dark theme. */
function readServerTheme(): Theme {
  return "dark";
}

function subscribeToDocumentTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

/** Provides the current theme and a toggle that persists the choice in the browser. */
export function ThemeProvider({ children }: { readonly children: ReactNode }) {
  // The `dark` class on <html> is the source of truth: theme-init.js sets it before paint.
  const theme = useSyncExternalStore(subscribeToDocumentTheme, readDocumentTheme, readServerTheme);

  const toggleTheme = useCallback(() => {
    const next: Theme = readDocumentTheme() === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private windows may block storage; the theme still applies for this visit.
    }
  }, []);

  return <ThemeContext value={{ theme, toggleTheme }}>{children}</ThemeContext>;
}

/** Returns the current theme and a function to switch it. */
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
