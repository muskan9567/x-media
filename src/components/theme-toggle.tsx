"use client";

import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Toggle color theme"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          />
        }
      >
        <SunIcon className="hidden dark:block" aria-hidden />
        <MoonIcon className="block dark:hidden" aria-hidden />
      </TooltipTrigger>
      <TooltipContent>Toggle color theme</TooltipContent>
    </Tooltip>
  );
}
