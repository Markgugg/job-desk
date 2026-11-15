import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type ThemeMode = "system" | "light" | "dark";
const MODES: ThemeMode[] = ["system", "light", "dark"];
const KEY = "jobdesk-theme";

function read(): ThemeMode {
  try {
    const value = localStorage.getItem(KEY);
    return (MODES as string[]).includes(value || "") ? (value as ThemeMode) : "dark";
  } catch {
    return "dark";
  }
}

interface ThemeCtx {
  mode: ThemeMode;
  next: () => void;
}

const Ctx = createContext<ThemeCtx>({ mode: "system", next: () => {} });

export function useTheme() {
  return useContext(Ctx);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(read);

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = mode === "dark" || (mode === "system" && media.matches);
      root.classList.toggle("dark", dark);
    };
    apply();
    media.addEventListener("change", apply);
    try {
      localStorage.setItem(KEY, mode);
    } catch {
      // Private window: the choice simply does not persist.
    }
    return () => media.removeEventListener("change", apply);
  }, [mode]);

  const next = useCallback(() => {
    setMode((current) => MODES[(MODES.indexOf(current) + 1) % MODES.length]);
  }, []);

  const value = useMemo(() => ({ mode, next }), [mode, next]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
