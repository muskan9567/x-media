import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { getXProvider } from "./provider";
import { createSeedState } from "./seed";
import { parseTrackerState } from "./state-schema";
import type { ProviderMode, TrackerState } from "./types";

const configuredPath = process.env.TRACKER_DATA_FILE?.trim();
const dataFilePath = configuredPath
  ? path.resolve(/*turbopackIgnore: true*/ process.cwd(), configuredPath)
  : path.join(process.cwd(), ".data", "tracker-state.json");

const operationQueuesKey = Symbol.for(
  "x-virality-tracker.tracker-store.operation-queues",
);
const sharedProcessState = globalThis as Record<PropertyKey, unknown>;
const existingOperationQueues = sharedProcessState[operationQueuesKey];
const operationQueues =
  existingOperationQueues instanceof Map
    ? (existingOperationQueues as Map<string, Promise<void>>)
    : new Map<string, Promise<void>>();
sharedProcessState[operationQueuesKey] = operationQueues;

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}

function sourceForLegacyAccount(value: unknown): ProviderMode {
  if (
    value &&
    typeof value === "object" &&
    "xUserId" in value &&
    String(value.xUserId).startsWith("mock-")
  ) {
    return "mock";
  }
  return "x";
}

function migrateLegacyState(value: unknown): unknown {
  if (!value || typeof value !== "object" || !("version" in value)) {
    return value;
  }
  const legacy = value as Record<string, unknown>;
  if (legacy.version !== 1) return value;

  const accounts = Array.isArray(legacy.accounts)
    ? legacy.accounts.map((account) =>
        account && typeof account === "object"
          ? { ...account, source: sourceForLegacyAccount(account) }
          : account,
      )
    : legacy.accounts;
  const accountSources = new Map<string, ProviderMode>();
  if (Array.isArray(accounts)) {
    for (const account of accounts) {
      if (
        account &&
        typeof account === "object" &&
        "id" in account &&
        "source" in account &&
        (account.source === "mock" || account.source === "x")
      ) {
        accountSources.set(String(account.id), account.source);
      }
    }
  }
  const tweets = Array.isArray(legacy.tweets)
    ? legacy.tweets.map((tweet) => {
        if (!tweet || typeof tweet !== "object") return tweet;
        const source =
          "accountId" in tweet
            ? accountSources.get(String(tweet.accountId))
            : undefined;
        return {
          ...tweet,
          source:
            source ??
            ("id" in tweet && String(tweet.id).startsWith("mock-")
              ? "mock"
              : "x"),
        };
      })
    : legacy.tweets;

  return { ...legacy, version: 2, accounts, tweets };
}

async function initialState(): Promise<TrackerState> {
  const now = new Date();
  if (getXProvider().mode === "mock") return createSeedState(now);
  return {
    version: 2,
    accounts: [],
    tweets: [],
    createdAt: now.toISOString(),
  };
}

async function persistState(state: TrackerState): Promise<void> {
  const validated = parseTrackerState(state);
  await mkdir(path.dirname(dataFilePath), { recursive: true });
  const temporaryPath = `${dataFilePath}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(
    temporaryPath,
    `${JSON.stringify(validated, null, 2)}\n`,
    "utf8",
  );
  try {
    await rename(temporaryPath, dataFilePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function initializeState(): Promise<TrackerState> {
  const state = await initialState();
  await persistState(state);
  return state;
}

async function recoverCorruptState(readError: unknown): Promise<TrackerState> {
  const quarantinePath = `${dataFilePath}.corrupt-${Date.now()}-${randomUUID()}`;
  try {
    await rename(dataFilePath, quarantinePath);
  } catch (quarantineError) {
    throw new AggregateError(
      [readError, quarantineError],
      "Tracker state is invalid and could not be quarantined.",
    );
  }
  return initializeState();
}

async function readStateFromDisk(): Promise<TrackerState> {
  let raw: string;
  try {
    raw = await readFile(dataFilePath, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return initializeState();
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return recoverCorruptState(error);
  }

  const migrated = migrateLegacyState(parsed);
  let state: TrackerState;
  try {
    state = parseTrackerState(migrated);
  } catch (error) {
    return recoverCorruptState(error);
  }

  if (migrated !== parsed) await persistState(state);
  return state;
}

function serializeOperation<T>(operation: () => Promise<T>): Promise<T> {
  const previous = operationQueues.get(dataFilePath) ?? Promise.resolve();
  const current = previous.then(operation);
  operationQueues.set(
    dataFilePath,
    current.then(
      () => undefined,
      () => undefined,
    ),
  );
  return current;
}

export function readTrackerState(): Promise<TrackerState> {
  return serializeOperation(readStateFromDisk);
}

export function updateTrackerState<T>(
  updater: (state: TrackerState) => Promise<[TrackerState, T]> | [TrackerState, T],
): Promise<T> {
  return serializeOperation(async () => {
    const current = await readStateFromDisk();
    const [next, result] = await updater(current);
    parseTrackerState(next);
    if (next !== current) await persistState(next);
    return result;
  });
}

export async function replaceTrackerState(state: TrackerState): Promise<void> {
  await updateTrackerState(async () => [state, undefined]);
}

export { dataFilePath };
