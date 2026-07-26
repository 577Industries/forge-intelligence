import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Forge Intelligence",
  description:
    "Real-time OSINT fusion console — a WebGL globe over public-domain intelligence feeds, with a passive-first reconnaissance toolkit.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#05070c" }}>{children}</body>
    </html>
  );
}
