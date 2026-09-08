"use client";

import { ArrowLeftIcon, PlayIcon } from "lucide-react";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";

export function MediaHeader({ source = "x" }: { source?: "x" | "posts" | "reddit" | "folders" }) {
  return <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur-md">
    <div className="mx-auto flex h-16 max-w-7xl items-center gap-1 px-3 sm:gap-3 sm:px-6 lg:px-8">
      <Link href="/" aria-label="X Media home" className="flex shrink-0 items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="relative flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-blue-500/20 bg-blue-500/10 text-blue-700 sm:size-9 sm:rounded-xl dark:text-blue-300">
          <PlayIcon className="relative z-10 size-5" aria-hidden />
          <span aria-hidden className="absolute inset-0 bg-[radial-gradient(circle_at_85%_10%,rgba(27,175,122,0.34),transparent_58%)]" />
        </span>
        <span className="hidden md:block"><span className="block font-semibold tracking-tight">X Media</span><span className="block text-xs text-muted-foreground">Media archive</span></span>
      </Link>
      <nav aria-label="Media source" className="flex shrink-0 items-center gap-0.5 rounded-lg border bg-card p-1 [&_a]:px-1.5 sm:ml-5 sm:gap-1 sm:[&_a]:px-2.5">
        <Button size="sm" variant={source === "x" ? "secondary" : "ghost"} nativeButton={false} role="link" render={<Link href="/" aria-current={source === "x" ? "page" : undefined} />}>X</Button>
        <Button size="sm" variant={source === "posts" ? "secondary" : "ghost"} nativeButton={false} role="link" render={<Link href="/posts" aria-current={source === "posts" ? "page" : undefined} />}>Tweets</Button>
        <Button size="sm" variant={source === "reddit" ? "secondary" : "ghost"} nativeButton={false} role="link" render={<Link href="/reddit" aria-current={source === "reddit" ? "page" : undefined} />}>Reddit</Button>
        <Button size="sm" variant={source === "folders" ? "secondary" : "ghost"} nativeButton={false} role="link" render={<Link href="/folders" aria-current={source === "folders" ? "page" : undefined} />}>Folders</Button>
      </nav>
      <div className="ml-auto flex items-center gap-0 sm:gap-2">
        <Button className="size-7 p-0 sm:h-8 sm:w-auto sm:px-2.5" variant="ghost" nativeButton={false} role="link" render={<Link href="/dashboard" aria-label="Dashboard" />}><ArrowLeftIcon aria-hidden /><span className="hidden sm:inline">Dashboard</span></Button>
        <ThemeToggle />
      </div>
    </div>
  </header>;
}
