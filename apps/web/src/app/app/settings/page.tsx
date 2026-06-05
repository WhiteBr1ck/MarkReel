"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { IconChevron } from "../_components/icons";
import { api } from "../_components/api";
import { type Accent, type Language, type Theme, useUiPreferences } from "../_components/theme";

function sanitizeWorkbenchHref(value: string | null): string {
  if (!value) return "/app";
  try {
    const url = new URL(value, "http://localhost");
    if (url.pathname !== "/app") return "/app";
    return `${url.pathname}${url.search}${url.hash}` || "/app";
  } catch {
    return "/app";
  }
}

const ACCENTS: Accent[] = ["clay", "blue", "green", "violet", "amber"];
const LANGUAGES: Language[] = ["zh-CN", "en"];
const THEMES: Theme[] = ["dark", "light", "system"];

type MeResponse = { user: { id: string } | null };

export default function SettingsPage() {
  const router = useRouter();
  const { preferences, patchPreferences, labels } = useUiPreferences();
  const [backHref, setBackHref] = useState<string>("/app");
  const [authReady, setAuthReady] = useState(false);
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);

  useEffect(() => {
    setBackHref(sanitizeWorkbenchHref(localStorage.getItem("mr_last_workbench_url")));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void api<MeResponse>("/me")
      .then((result) => {
        if (cancelled) return;
        if (!result.user) {
          router.replace("/app");
          return;
        }
        setAuthReady(true);
      })
      .catch(() => {
        if (!cancelled) router.replace("/app");
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (!languageMenuOpen) return;
    function closeMenu() {
      setLanguageMenuOpen(false);
    }
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, [languageMenuOpen]);

  const accentLabelMap = useMemo(
    () => ({
      clay: labels.common.accentClay,
      blue: labels.common.accentBlue,
      green: labels.common.accentGreen,
      violet: labels.common.accentViolet,
      amber: labels.common.accentAmber
    }),
    [labels.common]
  );

  const languageLabelMap = useMemo(
    () => ({
      "zh-CN": labels.common.languageZh,
      en: labels.common.languageEn
    }),
    [labels.common]
  );

  const themeLabelMap = useMemo(
    () => ({
      dark: labels.common.dark,
      light: labels.common.light,
      system: labels.common.system
    }),
    [labels.common]
  );

  if (!authReady) return null;

  return (
    <main className="mr-page">
      <div className="mr-page__shell">
        <section className="mr-panel mr-page__hero">
          <div className="mr-page__hero-head">
            <div>
              <div className="mr-page__eyebrow">{labels.settings.eyebrow}</div>
              <h1 className="mr-page__title">{labels.settings.title}</h1>
            </div>
            <Link href={backHref} prefetch={false} className="mr-btn mr-page__link">
              {labels.settings.back}
            </Link>
          </div>
        </section>

        <div className="mr-page__grid">
          <section className="mr-panel mr-page__card">
            <div className="mr-page__section-kicker">{labels.settings.appearanceKicker}</div>
            <h2 className="mr-page__section-title">{labels.settings.appearanceTitle}</h2>

            <div className="mr-page__stack">
              <div className="mr-field">
                <div className="mr-field__label">{labels.settings.themeLabel}</div>
                <div className="mr-page__actions">
                  {THEMES.map((theme) => (
                    <button
                      key={theme}
                      className={`mr-btn mr-btn--surface${preferences.theme === theme ? " mr-btn--primary" : ""}`}
                      type="button"
                      onClick={() => patchPreferences({ theme })}
                      disabled={preferences.theme === theme}
                    >
                      {themeLabelMap[theme]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mr-field">
                <div className="mr-field__label">{labels.settings.accentLabel}</div>
                <div className="mr-page__swatches">
                  {ACCENTS.map((accent) => (
                    <button
                      key={accent}
                      type="button"
                      className={`mr-page__swatch${preferences.accent === accent ? " mr-page__swatch--active" : ""}`}
                      onClick={() => patchPreferences({ accent })}
                    >
                      <span className={`mr-page__swatch-dot mr-page__swatch-dot--${accent}`} />
                      <span>{accentLabelMap[accent]}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="mr-panel mr-page__card">
            <div className="mr-page__section-kicker">{labels.settings.languageKicker}</div>
            <h2 className="mr-page__section-title">{labels.settings.languageTitle}</h2>
            <div className="mr-page__language-menu" onClick={(event) => event.stopPropagation()}>
              <button
                className="mr-btn mr-btn--menu mr-page__language-trigger"
                type="button"
                aria-label={labels.settings.languageTitle}
                aria-expanded={languageMenuOpen}
                onClick={() => setLanguageMenuOpen((open) => !open)}
              >
                <span>{languageLabelMap[preferences.language]}</span>
                <IconChevron size={16} dir="down" />
              </button>
              {languageMenuOpen ? (
                <div className="mr-panel mr-page__language-popover">
                  <div className="mr-page__language-list">
                    {LANGUAGES.map((language) => (
                      <button
                        key={language}
                        className={`mr-btn mr-btn--menu-item${preferences.language === language ? " mr-btn--menu-item-active" : ""}`}
                        type="button"
                        onClick={() => {
                          patchPreferences({ language });
                          setLanguageMenuOpen(false);
                        }}
                      >
                        {languageLabelMap[language]}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          <section className="mr-panel mr-page__card">
            <div className="mr-page__section-kicker">{labels.settings.workspaceKicker}</div>
            <h2 className="mr-page__section-title">{labels.settings.workspaceTitle}</h2>
            <div className="mr-page__stack">
              <button
                type="button"
                className="mr-page__toggle"
                onClick={() => patchPreferences({ showUploadQueue: !preferences.showUploadQueue })}
              >
                <span>
                  <strong>{labels.settings.showUploadQueue}</strong>
                  <small>{preferences.showUploadQueue ? labels.common.on : labels.common.off}</small>
                </span>
                <span className={`mr-page__toggle-pill${preferences.showUploadQueue ? " mr-page__toggle-pill--active" : ""}`}>
                  <span className="mr-page__toggle-knob" />
                </span>
              </button>

              <button
                type="button"
                className="mr-page__toggle"
                onClick={() => patchPreferences({ defaultInspectorOpen: !preferences.defaultInspectorOpen })}
              >
                <span>
                  <strong>{labels.settings.defaultInspectorOpen}</strong>
                  <small>{preferences.defaultInspectorOpen ? labels.common.on : labels.common.off}</small>
                </span>
                <span className={`mr-page__toggle-pill${preferences.defaultInspectorOpen ? " mr-page__toggle-pill--active" : ""}`}>
                  <span className="mr-page__toggle-knob" />
                </span>
              </button>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
