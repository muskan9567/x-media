const DECIMAL_INTEGER = /^\d+$/;

export function parsePositiveInteger(
  name: string,
  rawValue: string | undefined,
  defaultValue: number,
  maximum: number,
): number {
  const value = rawValue?.trim();
  if (!value) return defaultValue;
  if (!DECIMAL_INTEGER.test(value)) {
    throw new Error(`${name} must be a positive base-10 integer.`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${name} must be between 1 and ${maximum}.`);
  }
  return parsed;
}

export const trackerConfig = Object.freeze({
  maxTrackedAccounts: parsePositiveInteger(
    "MAX_TRACKED_ACCOUNTS",
    process.env.MAX_TRACKED_ACCOUNTS,
    25,
    1_000,
  ),
  retentionDays: parsePositiveInteger(
    "DATA_RETENTION_DAYS",
    process.env.DATA_RETENTION_DAYS,
    30,
    3_650,
  ),
  syncConcurrency: 3,
});
