import { useEffect, useState } from "react";

export type ThemeMode = "auto" | "light" | "dark";

const KEY = "rc-theme";

function systemDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function apply(mode: ThemeMode): boolean {
  const dark = mode === "dark" || (mode === "auto" && systemDark());
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  (document.documentElement.style as CSSStyleDeclaration & { colorScheme: string }).colorScheme =
    dark ? "dark" : "light";
  return dark;
}

export function useTheme(): {
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
  isDark: boolean;
} {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem(KEY);
    return saved === "light" || saved === "dark" ? saved : "auto";
  });
  const [isDark, setIsDark] = useState<boolean>(() => apply(mode));

  useEffect(() => {
    localStorage.setItem(KEY, mode);
    setIsDark(apply(mode));
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (mode === "auto") setIsDark(apply("auto"));
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode]);

  return { mode, setMode: setModeState, isDark };
}
