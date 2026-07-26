"use client";

/**
 * Forge Intelligence — console error boundary.
 *
 * The console mounts a WebGL globe, fifteen live feeds and six lazily-loaded
 * panels; any one of them throwing used to take the whole route down to a
 * blank document. This keeps the failure inside the console's own design
 * language and offers recovery without a full page load (`reset()` re-renders
 * the segment; the panels re-mount and the feeds re-fetch).
 *
 * Deliberately does NOT render the raw error text: this surface is public
 * (demo tier), and upstream fetch failures can carry internal URLs. The
 * digest is enough to correlate with server logs.
 */

import { useEffect } from "react";

export default function IntelligenceConsoleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[forge-intel] console error:", error);
  }, [error]);

  return (
    <main
      className="fi-viewport"
      style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <div className="fi-glass" style={{ padding: 22, maxWidth: 460 }}>
        <span className="fi-eyebrow">Console fault</span>
        <h1
          style={{
            fontSize: "1rem",
            color: "var(--color-fi-heading)",
            margin: "8px 0 10px",
          }}
        >
          The intelligence console stopped responding
        </h1>
        <p
          style={{
            fontSize: "0.82rem",
            lineHeight: 1.6,
            color: "var(--color-fi-text-2)",
            margin: 0,
          }}
        >
          A layer or panel failed to render. Retrying re-initialises the globe
          and re-fetches every enabled feed.
        </p>
        <div style={{ display: "flex", gap: 10, marginTop: 16, alignItems: "center" }}>
          <button
            type="button"
            onClick={reset}
            className="fi-label"
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              background: "var(--color-fi-sky)",
              color: "var(--color-fi-void)",
              fontWeight: 700,
              cursor: "pointer",
              border: 0,
            }}
          >
            Retry
          </button>
          <a
            href="/intelligence"
            className="fi-label"
            style={{ color: "var(--color-fi-sky)", textDecoration: "none" }}
          >
            ← Overview
          </a>
        </div>
        {error.digest && (
          <p
            className="fi-label"
            style={{ marginTop: 14, fontSize: "0.5rem", color: "var(--color-fi-muted)" }}
          >
            Reference {error.digest}
          </p>
        )}
      </div>
    </main>
  );
}
