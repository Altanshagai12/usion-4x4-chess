import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");

  return {
    metadataBase: new URL(`${protocol}://${host}`),
    title: "4×4 Chess: Last Man Stand",
    description:
      "Deploy, outsmart, and capture every rival piece in a fast 4×4 chess battle.",
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: {
      title: "4×4 Chess: Last Man Stand",
      description: "A fast two-player chess battle where every square matters.",
      type: "website",
      images: [{ url: "/og.png", width: 1536, height: 1024 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "4×4 Chess: Last Man Stand",
      description:
        "Deploy your army, promote pawns, and be the last player standing.",
      images: ["/og.png"],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <script
          src="https://usions.com/usion-sdk.js"
          defer
        />
      </body>
    </html>
  );
}
