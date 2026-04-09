"use client";

import { useEffect, useState } from "react";

export type Theme = "dark" | "light";

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

export function getStoredTheme(): Theme {
  const saved = localStorage.getItem("mr_theme");
  return saved === "light" ? "light" : "dark";
}

export function setStoredTheme(theme: Theme) {
  localStorage.setItem("mr_theme", theme);
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const t = getStoredTheme();
    setTheme(t);
    applyTheme(t);
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    setStoredTheme(next);
    applyTheme(next);
  }

  return { theme, toggle, setTheme };
}
