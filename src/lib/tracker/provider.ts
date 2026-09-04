import "server-only";

import { MockXProvider } from "./mock-provider";
import type { XDataProvider } from "./types";
import { OfficialXProvider } from "./x-provider";

let provider: XDataProvider | undefined;

export function getXProvider(): XDataProvider {
  if (provider) return provider;

  const token = process.env.X_BEARER_TOKEN?.trim();
  provider = token ? new OfficialXProvider(token) : new MockXProvider();
  return provider;
}

export function setProviderForTests(nextProvider: XDataProvider): void {
  provider = nextProvider;
}

export function resetProviderForTests(): void {
  provider = undefined;
}
