import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { Providers } from "@/components/providers";
import { Toaster } from "@/components/ui/sonner";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "X Media — Public X (Twitter) Video & Photo Archive",
    template: "%s · X Media",
  },
  description:
    "Find public X (Twitter) videos, photos, and GIFs by username. Browse a library saved on your computer, with no login or API key.",
  applicationName: "X Media",
  // Discovery belongs to the public repository; personal libraries stay private.
  robots: { index: false, follow: false },
  openGraph: {
    title: "X Media — Public X (Twitter) Media Archive",
    description: "Public videos, photos, and GIFs by username. A local library. No login or API key.",
    siteName: "X Media",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "X Media — Public X (Twitter) Media Archive",
    description: "Find public videos, photos, and GIFs by username. No login or API key.",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-background font-sans text-foreground">
        <Providers>
          {children}
          <Toaster
            position="bottom-right"
            richColors
            closeButton
            mobileOffset={{
              bottom: "calc(env(safe-area-inset-bottom) + 11rem)",
              left: 16,
              right: 16,
            }}
          />
        </Providers>
      </body>
    </html>
  );
}
