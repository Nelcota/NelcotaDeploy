import { useState } from "react";
import { toast } from "sonner";

import {
  defaultSidebarPreferences,
  parseSidebarPreferences,
  type SidebarPreferences,
} from "@/web/components/shell/sidebar/sidebar-preferences";

function loadPreferences(storageKey: string): SidebarPreferences {
  try {
    return parseSidebarPreferences(localStorage.getItem(storageKey));
  } catch (error) {
    console.warn("Could not read sidebar preferences", error);
    return defaultSidebarPreferences();
  }
}

/** Shares browser-local navigation preferences between the desktop and mobile menus. */
export function useSidebarPreferences(userId: string) {
  const storageKey = `nelcota-sidebar:v1:${userId}`;
  const [preferences, setPreferences] = useState(() => loadPreferences(storageKey));

  const updatePreferences = (next: SidebarPreferences) => {
    setPreferences(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch (error) {
      console.warn("Could not save sidebar preferences", error);
      toast.error("Não foi possível salvar suas preferências neste navegador.");
    }
  };
  return { preferences, updatePreferences };
}

export type SidebarState = ReturnType<typeof useSidebarPreferences>;
