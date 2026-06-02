"use client";

import { ACCENTS, type TweakState } from "@/lib/brain/tweaks";
import { useT } from "@/lib/brain/i18n";
import { Icon } from "./icons";

interface Props {
  open: boolean;
  state: TweakState;
  onChange: (patch: Partial<TweakState>) => void;
}

export function Tweaks({ open, state, onChange }: Props) {
  const t = useT();
  if (!open) return null;
  return (
    <div className="tweaks" role="dialog" aria-label={t("tweaks.title")}>
      <div className="tweaks-h">
        <Icon name="settings" size={12} />
        <span className="tweaks-h-title">{t("tweaks.title")}</span>
        <span className="tweaks-h-tag mono">brain</span>
      </div>
      <div className="tweaks-body">
        <div className="tweak-row">
          <span className="tweak-label">{t("tweaks.theme")}</span>
          <div className="tweak-seg">
            <button className={state.theme === "dark" ? "on" : ""} onClick={() => onChange({ theme: "dark" })}>{t("tweaks.dark")}</button>
            <button className={state.theme === "light" ? "on" : ""} onClick={() => onChange({ theme: "light" })}>{t("tweaks.light")}</button>
          </div>
        </div>

        <div className="tweak-row">
          <span className="tweak-label">{t("tweaks.accent")}</span>
          <div className="tweak-swatches">
            {(Object.entries(ACCENTS) as [keyof typeof ACCENTS, (typeof ACCENTS)[keyof typeof ACCENTS]][]).map(
              ([k, v]) => (
                <button
                  key={k}
                  className={`tweak-swatch ${state.accent === k ? "on" : ""}`}
                  style={{ background: v.c }}
                  onClick={() => onChange({ accent: k })}
                  title={k}
                  aria-label={`Accent ${k}`}
                />
              ),
            )}
          </div>
        </div>

        <div className="tweak-row">
          <span className="tweak-label">{t("tweaks.density")}</span>
          <div className="tweak-seg">
            <button className={state.density === "spacious" ? "on" : ""} onClick={() => onChange({ density: "spacious" })}>{t("tweaks.spacious")}</button>
            <button className={state.density === "balanced" ? "on" : ""} onClick={() => onChange({ density: "balanced" })}>{t("tweaks.balanced")}</button>
            <button className={state.density === "dense" ? "on" : ""} onClick={() => onChange({ density: "dense" })}>{t("tweaks.dense")}</button>
          </div>
        </div>

        <div className="tweak-row">
          <span className="tweak-label">{t("tweaks.language")}</span>
          <div className="tweak-seg">
            <button className={state.language === "en" ? "on" : ""} onClick={() => onChange({ language: "en" })}>EN</button>
            <button className={state.language === "th" ? "on" : ""} onClick={() => onChange({ language: "th" })}>ไทย</button>
            <button className={state.language === "de" ? "on" : ""} onClick={() => onChange({ language: "de" })}>DE</button>
          </div>
        </div>
      </div>
    </div>
  );
}
