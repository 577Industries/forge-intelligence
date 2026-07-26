"use client";

/**
 * Forge Intelligence — live broadcast viewer.
 *
 * Plays a 24/7 news channel selected from the broadcast layer.
 *
 * Playback policy (deliberately narrower than the upstream, which hot-linked
 * arbitrary streams): channels that permit embedding play through YouTube's
 * OFFICIAL privacy-preserving player — the sanctioned mechanism — and nothing
 * is proxied or re-hosted by us. Channels that block embedding are NOT forced
 * into a frame; they open on the broadcaster's own site instead.
 */

import type { NewsFeed } from "@/intelligence/lib/types";

export function LiveFeedViewer({
  feed,
  onClose,
}: {
  feed: NewsFeed | null;
  onClose: () => void;
}) {
  if (!feed) return null;

  const embedUrl = `https://www.youtube-nocookie.com/embed/live_stream?channel=${encodeURIComponent(
    feed.channelId,
  )}&autoplay=1&mute=1`;

  return (
    <div
      role="dialog"
      aria-label={`Live broadcast: ${feed.name}`}
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(2,4,8,0.72)",
        zIndex: 500,
      }}
      onClick={onClose}
    >
      <div
        className="fi-glass"
        style={{ width: "min(880px, 88vw)", padding: 14 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            marginBottom: 10,
          }}
        >
          <div>
            <span className="fi-eyebrow">Live Broadcast</span>
            <div style={{ fontSize: "0.95rem", color: "var(--color-fi-heading)", marginTop: 2 }}>
              {feed.name}{" "}
              <span style={{ color: "var(--color-fi-text-2)", fontSize: "0.8rem" }}>
                · {feed.city}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="fi-label"
            aria-label="Close broadcast"
            style={{ cursor: "pointer", color: "var(--color-fi-muted)", background: "none" }}
          >
            ✕
          </button>
        </div>

        {feed.embeddable ? (
          <div
            style={{
              position: "relative",
              width: "100%",
              aspectRatio: "16 / 9",
              borderRadius: 10,
              overflow: "hidden",
              background: "#000",
            }}
          >
            <iframe
              src={embedUrl}
              title={`${feed.name} live stream`}
              allow="accelerometer; autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
            />
          </div>
        ) : (
          <div
            style={{
              padding: 20,
              borderRadius: 10,
              border: "1px solid var(--color-fi-rule)",
              background: "var(--color-fi-surface)",
            }}
          >
            <p style={{ fontSize: "0.85rem", lineHeight: 1.6, color: "var(--color-fi-text-2)" }}>
              {feed.name} does not permit embedded playback. Rather than force it
              into a frame, open the broadcaster&apos;s own stream:
            </p>
            <a
              href={feed.url}
              target="_blank"
              rel="noopener noreferrer"
              className="fi-label"
              style={{
                display: "inline-block",
                marginTop: 12,
                padding: "8px 14px",
                borderRadius: 8,
                background: "var(--color-fi-sky)",
                color: "var(--color-fi-void)",
                fontWeight: 700,
                textDecoration: "none",
              }}
            >
              Open {feed.name} ↗
            </a>
          </div>
        )}

        {/* Broadcasters can revoke embedding at any time, and an iframe
            failure is invisible to us cross-origin ("Video unavailable"
            renders inside YouTube's document). So every embed keeps a visible
            escape hatch rather than stranding the operator on a dead frame. */}
        <div
          style={{
            marginTop: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <span className="fi-label" style={{ fontSize: "0.55rem" }}>
            Played via the broadcaster&apos;s official player · not proxied or re-hosted
          </span>
          {feed.embeddable && (
            <a
              href={feed.url}
              target="_blank"
              rel="noopener noreferrer"
              className="fi-label"
              style={{ fontSize: "0.55rem", color: "var(--color-fi-sky)" }}
            >
              Not playing? Open {feed.name} ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
