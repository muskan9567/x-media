"use client";

import {
  BadgeCheckIcon,
  LoaderCircleIcon,
  Settings2Icon,
  Trash2Icon,
} from "lucide-react";
import { FormEvent, useRef, useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
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
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { TrackedAccount } from "@/lib/tracker/types";

import { compactNumber, relativeTime } from "./format";

interface AccountTableProps {
  accounts: TrackedAccount[];
  referenceTimestamp: number;
  busyAccountIds?: ReadonlySet<string>;
  onToggle: (account: TrackedAccount, active: boolean) => Promise<void>;
  onDelete: (account: TrackedAccount) => Promise<void>;
  onUpdateNiches: (account: TrackedAccount, niches: string[]) => Promise<void>;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function removeButtonId(accountId: string): string {
  return `remove-account-${encodeURIComponent(accountId)}`;
}

export function AccountTable({
  accounts,
  referenceTimestamp,
  busyAccountIds,
  onToggle,
  onDelete,
  onUpdateNiches,
}: AccountTableProps) {
  const [deleteTarget, setDeleteTarget] = useState<TrackedAccount | null>(null);
  const [editTarget, setEditTarget] = useState<TrackedAccount | null>(null);
  const [nicheInput, setNicheInput] = useState("");
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const deleteFocusTargetRef = useRef<string | null>(null);

  function openEdit(account: TrackedAccount) {
    setDialogError(null);
    setEditTarget(account);
    setNicheInput(account.manualNiches.join(", "));
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const targetIndex = accounts.findIndex(
      (account) => account.id === deleteTarget.id,
    );
    const adjacentAccount =
      accounts[targetIndex + 1] ?? accounts[targetIndex - 1] ?? null;
    setDialogBusy(true);
    setDialogError(null);
    try {
      await onDelete(deleteTarget);
      deleteFocusTargetRef.current = adjacentAccount
        ? removeButtonId(adjacentAccount.id)
        : "tracked-accounts-heading";
      setDeleteTarget(null);
    } catch (error) {
      setDialogError(
        error instanceof Error ? error.message : "The account could not be removed.",
      );
    } finally {
      setDialogBusy(false);
    }
  }

  async function saveNiches(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editTarget) return;
    setDialogBusy(true);
    setDialogError(null);
    try {
      await onUpdateNiches(
        editTarget,
        nicheInput
          .split(",")
          .map((niche) => niche.trim())
          .filter(Boolean),
      );
      setEditTarget(null);
    } catch (error) {
      setDialogError(
        error instanceof Error ? error.message : "The niches could not be updated.",
      );
    } finally {
      setDialogBusy(false);
    }
  }

  return (
    <>
      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <caption className="sr-only">
            Accounts currently included in the X virality watchlist
          </caption>
          <TableHeader>
            <TableRow>
              <TableHead>Account</TableHead>
              <TableHead>Niches</TableHead>
              <TableHead className="text-right">Audience</TableHead>
              <TableHead>Last sync</TableHead>
              <TableHead className="text-center">Tracking</TableHead>
              <TableHead className="w-24 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.map((account) => {
              const busy = busyAccountIds?.has(account.id) ?? false;
              const niches = [
                ...account.manualNiches,
                ...account.inferredNiches,
              ].slice(0, 3);

              return (
                <TableRow key={account.id}>
                  <TableCell>
                    <div className="flex min-w-52 items-center gap-3">
                      <Avatar className="size-9 border">
                        <AvatarImage
                          src={account.profileImageUrl}
                          alt=""
                          referrerPolicy="no-referrer"
                        />
                        <AvatarFallback>{initials(account.displayName)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 font-medium">
                          <span className="truncate">{account.displayName}</span>
                          {account.source === "mock" && (
                            <Badge variant="outline" className="shrink-0 text-[10px]">
                              Demo
                            </Badge>
                          )}
                          {account.verified && (
                            <BadgeCheckIcon
                              className="size-4 shrink-0 text-blue-600"
                              aria-label="Verified account"
                            />
                          )}
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          @{account.username}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex min-w-52 flex-wrap gap-1.5">
                      {niches.length ? (
                        niches.map((niche) => (
                          <Badge key={niche} variant="secondary">
                            {niche}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Learning…
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {compactNumber(account.followersCount)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {account.syncStatus === "error" ? (
                      <span className="text-destructive" title={account.syncError}>
                        Sync error
                        {account.syncError && (
                          <span className="sr-only">: {account.syncError}</span>
                        )}
                      </span>
                    ) : account.lastSyncedAt ? (
                      relativeTime(account.lastSyncedAt, referenceTimestamp)
                    ) : (
                      "Never"
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    <Switch
                      checked={account.active}
                      onCheckedChange={(active) => void onToggle(account, active)}
                      disabled={busy}
                      aria-label={`${account.active ? "Pause" : "Resume"} tracking @${account.username}`}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Edit niches for @${account.username}`}
                        disabled={busy}
                        onClick={() => openEdit(account)}
                      >
                        <Settings2Icon aria-hidden />
                      </Button>
                      <Button
                        id={removeButtonId(account.id)}
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Remove @${account.username}`}
                        disabled={busy}
                        onClick={() => {
                          deleteFocusTargetRef.current = removeButtonId(account.id);
                          setDialogError(null);
                          setDeleteTarget(account);
                        }}
                      >
                        {busy ? (
                          <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" aria-hidden />
                        ) : (
                          <Trash2Icon aria-hidden />
                        )}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setDialogError(null);
          }
        }}
      >
        <DialogContent
          finalFocus={() => {
            const targetId = deleteFocusTargetRef.current;
            return targetId ? document.getElementById(targetId) : undefined;
          }}
        >
          <DialogHeader>
            <DialogTitle>Remove tracked account?</DialogTitle>
            <DialogDescription>
              {deleteTarget
                ? `This removes @${deleteTarget.username} and all locally stored post snapshots from this tracker.`
                : "This removes the account and its local post snapshots."}
            </DialogDescription>
          </DialogHeader>
          {dialogError && (
            <p className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
              {dialogError}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={dialogBusy}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void confirmDelete()}
              disabled={dialogBusy}
            >
              {dialogBusy && (
                <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" aria-hidden />
              )}
              Remove account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(editTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setEditTarget(null);
            setDialogError(null);
          }
        }}
      >
        <DialogContent>
          <form onSubmit={saveNiches}>
            <DialogHeader>
              <DialogTitle>Edit priority niches</DialogTitle>
              <DialogDescription>
                Manual niches override inferred labels and strengthen reply-fit matching.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-5 space-y-2">
              <label htmlFor="edit-niches" className="text-sm font-medium">
                Niches for @{editTarget?.username}
              </label>
              <Input
                id="edit-niches"
                value={nicheInput}
                onChange={(event) => setNicheInput(event.target.value)}
                placeholder="AI, SaaS, creator economy"
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Up to six comma-separated labels.
              </p>
              {dialogError && (
                <p className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
                  {dialogError}
                </p>
              )}
            </div>
            <DialogFooter className="mt-5">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditTarget(null)}
                disabled={dialogBusy}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={dialogBusy}>
                {dialogBusy && (
                  <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" aria-hidden />
                )}
                Save niches
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
