/**
 * Forge Intelligence — console (app) layout.
 *
 * Applies the `.fi-root` scoped design system + subsystem accent + the
 * self-hosted HUD font stack to the /intelligence/app subtree ONLY. The
 * sibling marketing page (src/app/intelligence/page.tsx) deliberately does
 * NOT get this scope — it renders in the standard 577i site chrome.
 *
 * This is the isolation boundary (mirrors src/app/cfraw/layout.tsx): the
 * console owns the full viewport inside `.fi-root`, but never mutates
 * html/body globals. `robots: noindex` keeps the app out of search — the
 * public /intelligence marketing page is the indexable surface.
 *
 * Phase 4 wraps the dashboard in an (protected) route-group guard; for now
 * the console is open (public demo tier).
 */

import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";

import "../intelligence.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-fi-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-fi-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Forge Intelligence — Console",
  robots: "noindex, nofollow",
};

export default function IntelligenceAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      data-subsystem="intelligence"
      className={`fi-root ${inter.variable} ${jetbrainsMono.variable}`}
    >
      {children}
    </div>
  );
}
