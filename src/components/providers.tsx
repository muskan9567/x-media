"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

import { TooltipProvider } from "@/components/ui/tooltip";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      <TooltipProvider delay={350}>{children}</TooltipProvider>
    </NextThemesProvider>
  );
}
