let accountId: string | null = null;
const listeners = new Set<() => void>();

export function accountStorageKey(baseKey: string): string {
  return accountId ? `${baseKey}:account:${encodeURIComponent(accountId)}` : baseKey;
}

export function setStorageAccount(nextAccountId: string | null): void {
  if (accountId === nextAccountId) return;
  accountId = nextAccountId;
  listeners.forEach((listener) => listener());
}

export function subscribeStorageAccount(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
