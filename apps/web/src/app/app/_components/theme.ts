"use client";

import { useEffect, useMemo, useState } from "react";

export type Theme = "dark" | "light" | "system";
export type Accent = "clay" | "blue" | "green" | "violet" | "amber";
export type Language = "zh-CN" | "en";

type ResolvedTheme = "dark" | "light";

export type UiPreferences = {
  theme: Theme;
  accent: Accent;
  language: Language;
  showUploadQueue: boolean;
  defaultInspectorOpen: boolean;
  rememberPlaybackPosition: boolean;
};

type BooleanPreferenceKey = "showUploadQueue" | "defaultInspectorOpen" | "rememberPlaybackPosition";

const STORAGE_KEYS = {
  theme: "mr_theme",
  accent: "mr_accent",
  language: "mr_language",
  showUploadQueue: "mr_show_upload_queue",
  defaultInspectorOpen: "mr_default_inspector_open",
  rememberPlaybackPosition: "mr_remember_playback_position"
} as const;

const DEFAULT_PREFERENCES: UiPreferences = {
  theme: "dark",
  accent: "clay",
  language: "zh-CN",
  showUploadQueue: true,
  defaultInspectorOpen: true,
  rememberPlaybackPosition: true
};

const ACCENTS: Accent[] = ["clay", "blue", "green", "violet", "amber"];
const LANGUAGES: Language[] = ["zh-CN", "en"];

function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme !== "system") return theme;
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function subscribeToSystemThemeChange(onChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => onChange();
  if (typeof media.addEventListener === "function") {
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }
  media.addListener(handler);
  return () => media.removeListener(handler);
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = resolveTheme(theme);
}

export function applyAccent(accent: Accent) {
  document.documentElement.dataset.accent = accent;
}

export function getStoredTheme(): Theme {
  const saved = localStorage.getItem(STORAGE_KEYS.theme);
  return saved === "light" || saved === "system" ? saved : "dark";
}

export function getStoredAccent(): Accent {
  const saved = localStorage.getItem(STORAGE_KEYS.accent);
  return ACCENTS.includes(saved as Accent) ? (saved as Accent) : DEFAULT_PREFERENCES.accent;
}

export function getStoredLanguage(): Language {
  const saved = localStorage.getItem(STORAGE_KEYS.language);
  return LANGUAGES.includes(saved as Language) ? (saved as Language) : DEFAULT_PREFERENCES.language;
}

export function getStoredBooleanPreference(key: BooleanPreferenceKey, fallback: boolean) {
  const saved = localStorage.getItem(STORAGE_KEYS[key]);
  if (saved === "true") return true;
  if (saved === "false") return false;
  return fallback;
}

export function getStoredPreferences(): UiPreferences {
  return {
    theme: getStoredTheme(),
    accent: getStoredAccent(),
    language: getStoredLanguage(),
    showUploadQueue: getStoredBooleanPreference("showUploadQueue", DEFAULT_PREFERENCES.showUploadQueue),
    defaultInspectorOpen: getStoredBooleanPreference("defaultInspectorOpen", DEFAULT_PREFERENCES.defaultInspectorOpen),
    rememberPlaybackPosition: getStoredBooleanPreference("rememberPlaybackPosition", DEFAULT_PREFERENCES.rememberPlaybackPosition)
  };
}

export function setStoredTheme(theme: Theme) {
  localStorage.setItem(STORAGE_KEYS.theme, theme);
}

export function setStoredAccent(accent: Accent) {
  localStorage.setItem(STORAGE_KEYS.accent, accent);
}

export function setStoredLanguage(language: Language) {
  localStorage.setItem(STORAGE_KEYS.language, language);
}

export function setStoredBooleanPreference(key: BooleanPreferenceKey, value: boolean) {
  localStorage.setItem(STORAGE_KEYS[key], String(value));
}

export function setStoredPreferences(next: UiPreferences) {
  setStoredTheme(next.theme);
  setStoredAccent(next.accent);
  setStoredLanguage(next.language);
  setStoredBooleanPreference("showUploadQueue", next.showUploadQueue);
  setStoredBooleanPreference("defaultInspectorOpen", next.defaultInspectorOpen);
  setStoredBooleanPreference("rememberPlaybackPosition", next.rememberPlaybackPosition);
}

export function applyStoredPreferences() {
  const prefs = getStoredPreferences();
  applyTheme(prefs.theme);
  applyAccent(prefs.accent);
  return prefs;
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(DEFAULT_PREFERENCES.theme);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(resolveTheme(DEFAULT_PREFERENCES.theme));

  useEffect(() => {
    const prefs = applyStoredPreferences();
    setThemeState(prefs.theme);
    setResolvedTheme(resolveTheme(prefs.theme));
  }, []);

  useEffect(() => {
    if (theme !== "system") return;
    return subscribeToSystemThemeChange(() => {
      setResolvedTheme(resolveTheme("system"));
      applyTheme("system");
    });
  }, [theme]);

  function setTheme(theme: Theme) {
    setThemeState(theme);
    setResolvedTheme(resolveTheme(theme));
    setStoredTheme(theme);
    applyTheme(theme);
  }

  function toggle() {
    const next: Theme = resolvedTheme === "dark" ? "light" : "dark";
    setTheme(next);
  }

  return { theme, resolvedTheme, toggle, setTheme };
}

export function useUiPreferences() {
  const [preferences, setPreferencesState] = useState<UiPreferences>(DEFAULT_PREFERENCES);

  useEffect(() => {
    setPreferencesState(applyStoredPreferences());
  }, []);

  useEffect(() => {
    if (preferences.theme !== "system") return;
    return subscribeToSystemThemeChange(() => {
      applyTheme("system");
    });
  }, [preferences.theme]);

  function setPreferences(next: UiPreferences) {
    setPreferencesState(next);
    setStoredPreferences(next);
    applyTheme(next.theme);
    applyAccent(next.accent);
  }

  function patchPreferences(patch: Partial<UiPreferences>) {
    setPreferences({ ...preferences, ...patch });
  }

  return {
    preferences,
    setPreferences,
    patchPreferences,
    labels: useMemo(() => buildLanguagePack(preferences.language), [preferences.language])
  };
}

function buildLanguagePack(language: Language) {
  if (language === "en") {
    return {
      shell: {
        navProjects: "Projects",
        navSettings: "General settings",
        navAbout: "About",
        userMenuLabel: "Current user",
        userSettings: "User settings",
        adminSettings: "Admin settings",
        logout: "Log out",
        userAriaLabel: "User",
        topbarKicker: "Workbench",
        topbarTitle: "Project workspace",
        uploadsKicker: "Upload queue",
        uploadsTitle: "Upload and processing",
        clearUploads: "Clear history",
        uploadTasks: "tasks",
        uploadActive: "active"
      },
      settings: {
        eyebrow: "Settings",
        title: "General settings",
        lead: "",
        back: "Back to workbench",
        appearanceKicker: "Appearance",
        appearanceTitle: "Theme and accent",
        appearanceNote: "",
        themeLabel: "Theme",
        accentLabel: "Accent",
        languageKicker: "Language",
        languageTitle: "Interface language",
        languageNote: "",
        workspaceKicker: "Workspace",
        workspaceTitle: "Default behavior",
        workspaceNote: "",
        showUploadQueue: "Show upload queue",
        defaultInspectorOpen: "Open inspector by default",
        rememberPlaybackPosition: "Remember video progress"
      },
      common: {
        dark: "Dark",
        light: "Light",
        system: "System",
        languageZh: "Chinese",
        languageEn: "English",
        accentClay: "Clay",
        accentBlue: "Blue",
        accentGreen: "Green",
        accentViolet: "Violet",
        accentAmber: "Amber",
        on: "On",
        off: "Off"
      }
    };
  }

  return {
    shell: {
      navProjects: "项目首页",
      navSettings: "通用设置",
      navAbout: "关于",
      userMenuLabel: "当前用户",
      userSettings: "用户设置",
      adminSettings: "管理员设置",
      logout: "退出登录",
      userAriaLabel: "用户",
      topbarKicker: "Workbench",
      topbarTitle: "项目工作台",
      uploadsKicker: "Upload queue",
      uploadsTitle: "上传与处理进度",
      clearUploads: "清空记录",
      uploadTasks: "项任务",
      uploadActive: "进行中"
    },
    settings: {
      eyebrow: "Settings",
      title: "通用设置",
      lead: "",
      back: "返回工作台",
      appearanceKicker: "Appearance",
      appearanceTitle: "主题与强调色",
      appearanceNote: "",
      themeLabel: "主题模式",
      accentLabel: "强调色",
      languageKicker: "Language",
      languageTitle: "界面语言",
      languageNote: "",
      workspaceKicker: "Workspace",
      workspaceTitle: "默认行为",
      workspaceNote: "",
      showUploadQueue: "显示上传队列",
      defaultInspectorOpen: "默认开启检查器面板",
      rememberPlaybackPosition: "记住视频播放进度"
    },
    common: {
      dark: "深色",
      light: "浅色",
      system: "跟随系统",
      languageZh: "中文",
      languageEn: "English",
      accentClay: "陶土",
      accentBlue: "海蓝",
      accentGreen: "松绿",
      accentViolet: "紫罗兰",
      accentAmber: "琥珀",
      on: "开启",
      off: "关闭"
    }
  };
}
