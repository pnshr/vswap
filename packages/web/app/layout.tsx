import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  metadataBase: new URL("https://vswap-web.vercel.app"),
  title: {
    default: "vswap — Solana validator identity hot-swap",
    template: "%s · vswap",
  },
  description:
    "Operator dashboard for vswap: move a running Solana validator's voting identity between hosts with a 1–3 second downtime window, without exposing the identity key in plaintext on any intermediate system.",
  openGraph: {
    title: "vswap",
    description:
      "Solana validator identity hot-swap — operator dashboard.",
    siteName: "vswap",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "vswap",
    description:
      "Solana validator identity hot-swap — operator dashboard.",
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans text-foreground">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
