import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { Geist, JetBrains_Mono, Fraunces, Noto_Sans_Thai } from "next/font/google";
import { LangProvider } from "@/components/brain/lang-provider";
import type { Lang } from "@/lib/brain/i18n";
import "./globals.css";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  weight: ["400", "500", "600"],
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  weight: ["400", "500"],
  display: "swap",
});

const notoThai = Noto_Sans_Thai({
  subsets: ["thai"],
  variable: "--font-noto-thai",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata = {
  title: "External Brain",
  description:
    "The knowledge you build while coding with any AI tool, made permanent and portable.",
};

const preHydrateTweaks = `
(function(){
  try {
    var t = JSON.parse(localStorage.getItem('bp_tweaks') || 'null') || {};
    // Each accent ships TWO colors:
    //   c       — the brand fill on dark bg (and accent-fill use everywhere)
    //   cText   — a darkened variant for use as foreground TEXT on light bg.
    //             Without this, lime/coral/blue/violet on white fail WCAG AA.
    //   ink     — high-contrast text color when used as background fill (always ~black for our palette)
    var accents = {
      lime:   { c: '#D8FF3E', cText: '#5C7A00', ink: '#0A0A0B' },
      violet: { c: '#C5A8FF', cText: '#6B4FB8', ink: '#0A0A0B' },
      coral:  { c: '#FF9571', cText: '#B8462A', ink: '#0A0A0B' },
      blue:   { c: '#7EC8FF', cText: '#1F5C99', ink: '#0A0A0B' }
    };
    // First-visit default is light (2026-08-09) — see DEFAULT_TWEAKS in
    // tweaks.ts for the full rationale. This fallback only fires when
    // localStorage has no stored preference; an existing user's saved theme
    // (dark included) always wins.
    var theme = t.theme || 'light';
    // Prefer the bp_lang cookie (the server-readable source the root layout
    // renders <html lang> from) over localStorage, so this pre-hydrate script
    // doesn't clobber the cookie-derived SSR value when localStorage is empty
    // (e.g. a cross-browser visitor who set the locale elsewhere). #36.
    var cookieLang = (document.cookie.match(/(?:^|;\\s*)bp_lang=(en|th|de)\\b/) || [])[1];
    var lang = cookieLang || t.language || 'en';
    var density = t.density || 'balanced';
    var accent = t.accent || 'lime';
    var root = document.documentElement;
    root.setAttribute('data-theme', theme);
    root.setAttribute('lang', lang);
    root.setAttribute('data-density', density);
    var a = accents[accent] || accents.lime;
    root.style.setProperty('--accent', a.c);
    root.style.setProperty('--accent-ink', a.ink);
    root.style.setProperty('--accent-soft', a.c + '24');
    root.style.setProperty('--accent-wash', a.c + '10');
    // Theme-aware text variant: dark mode keeps the bright fill (good on dark
    // bg). Light mode swaps in the darkened variant so lime "live" pills,
    // citation chips, accent-tinted headers etc actually pass AA.
    root.style.setProperty('--accent-text', theme === 'light' ? a.cText : a.c);
  } catch (e) {}
})();
`;

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Resolve locale server-side from the `bp_lang` cookie so unauth surfaces
  // (/signin, /welcome, …) render in the user's language on first paint, and
  // so LangProvider's first client render matches SSR exactly (no #418). #3.
  const cookieLang = (await cookies()).get("bp_lang")?.value;
  const lang: Lang = cookieLang === "th" || cookieLang === "de" ? cookieLang : "en";
  return (
    <html
      lang={lang}
      // Server-rendered default, matching DEFAULT_TWEAKS.theme in tweaks.ts.
      // A visitor with a saved dark preference still gets dark — the
      // pre-hydrate script (below) overwrites this from localStorage before
      // first paint. This value is what a no-JS client or the very first
      // parsed frame sees, so it has to agree with the other two defaults.
      data-theme="light"
      data-density="balanced"
      className={`${geist.variable} ${jetbrains.variable} ${fraunces.variable} ${notoThai.variable}`}
      suppressHydrationWarning
    >
      <head>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        <script dangerouslySetInnerHTML={{ __html: preHydrateTweaks }} />
      </head>
      <body className="antialiased">
        <LangProvider initial={lang}>{children}</LangProvider>
      </body>
    </html>
  );
}
