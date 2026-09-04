"use client";

import { AtSignIcon, LoaderCircleIcon, PlusIcon } from "lucide-react";
import { FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface AddAccountDialogProps {
  open: boolean;
  demoMode: boolean;
  trackedUsernames: readonly string[];
  onOpenChange: (open: boolean) => void;
  onAdd: (username: string, niches: string[]) => Promise<void>;
}

const DEMO_SUGGESTIONS = ["buildwithmaya", "growthnotes", "designshift"];

function normalizeUsername(username: string): string {
  return username.trim().replace(/^@/, "").toLowerCase();
}

export function AddAccountDialog({
  open,
  demoMode,
  trackedUsernames,
  onOpenChange,
  onAdd,
}: AddAccountDialogProps) {
  const [username, setUsername] = useState("");
  const [niches, setNiches] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trackedUsernameSet = new Set(trackedUsernames.map(normalizeUsername));
  const demoSuggestions = DEMO_SUGGESTIONS.filter(
    (suggestion) => !trackedUsernameSet.has(normalizeUsername(suggestion)),
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onAdd(
        username,
        niches
          .split(",")
          .map((niche) => niche.trim())
          .filter(Boolean),
      );
      setUsername("");
      setNiches("");
      onOpenChange(false);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "The account could not be added.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Track an X account</DialogTitle>
            <DialogDescription>
              Add a public account. Its recent posts help infer niches and build an
              account-normalized virality baseline.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-5 space-y-4">
            <div className="space-y-2">
              <label htmlFor="x-username" className="text-sm font-medium">
                X username
              </label>
              <div className="relative">
                <AtSignIcon
                  className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  id="x-username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="username"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  className="pl-8"
                  required
                  maxLength={16}
                  aria-describedby="x-username-help"
                />
              </div>
              <p id="x-username-help" className="text-xs text-muted-foreground">
                {demoMode
                  ? "Demo mode generates realistic local data for any valid handle."
                  : "The account is resolved through the official X API."}
              </p>
            </div>

            <div className="space-y-2">
              <label htmlFor="account-niches" className="text-sm font-medium">
                Priority niches <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <Input
                id="account-niches"
                value={niches}
                onChange={(event) => setNiches(event.target.value)}
                placeholder="AI, SaaS, creator economy"
                aria-describedby="account-niches-help"
              />
              <p id="account-niches-help" className="text-xs text-muted-foreground">
                Comma-separated. These override inferred labels for reply matching.
              </p>
            </div>

            {demoMode && demoSuggestions.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  Try a demo handle
                </p>
                <div className="flex flex-wrap gap-2">
                  {demoSuggestions.map((suggestion) => (
                    <Button
                      key={suggestion}
                      type="button"
                      size="xs"
                      variant="outline"
                      onClick={() => setUsername(suggestion)}
                    >
                      @{suggestion}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {error && (
              <p
                className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive"
                role="alert"
              >
                {error}
              </p>
            )}
          </div>

          <DialogFooter className="mt-5">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !username.trim()}>
              {submitting ? (
                <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" aria-hidden />
              ) : (
                <PlusIcon aria-hidden />
              )}
              {submitting ? "Adding account" : "Add to watchlist"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
