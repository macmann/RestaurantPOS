import { AsyncLocalStorage } from 'node:async_hooks';
import { isSqlRepositoryEnabled, withTransaction } from './client';

const active = new AsyncLocalStorage<boolean>();
let pending: Promise<void> = Promise.resolve();
const snapshots: Array<() => () => void> = [];

/** Register the reversible state of an in-memory repository. */
export function registerOperationalMemoryState<T>(store: Map<string, T> | T[]): void {
  snapshots.push(() => {
    const before = structuredClone(store);
    return () => {
      if (store instanceof Map && before instanceof Map) { store.clear(); for (const [key, value] of before) store.set(key, value); }
      else if (Array.isArray(store) && Array.isArray(before)) store.splice(0, store.length, ...before);
    };
  });
}

/** Serialize related writes so payments cannot race a transfer, void or repricing. */
export async function withOperationalWrite<T>(callback: () => Promise<T>): Promise<T> {
  if (active.getStore()) return callback();
  const previous = pending;
  let release!: () => void;
  pending = new Promise<void>(resolve => { release = resolve; });
  await previous;
  const restore = isSqlRepositoryEnabled() ? [] : snapshots.map(snapshot => snapshot());
  try {
    return await active.run(true, () => withTransaction(async client => {
      if (isSqlRepositoryEnabled()) await client.query("SELECT pg_advisory_xact_lock(hashtext('restaurant-pos-operational-write'))");
      return callback();
    }));
  } catch (error) {
    for (const rollback of restore) rollback();
    throw error;
  } finally { release(); }
}
