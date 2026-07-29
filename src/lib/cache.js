/**
 * TTL cache on top of chrome.storage.local.
 *
 * Bumping SCHEMA invalidates everything, which is what you want after changing
 * the shape of a stored record or the matching logic.
 */

const SCHEMA = 2; // v2: multi-campus lookups; invalidates single-school misses
const PREFIX = `c${SCHEMA}:`;
const MAX_ENTRIES = 1500;

export const TTL = {
  HIT: 14 * 24 * 60 * 60 * 1000,   // rating data changes slowly
  MISS: 3 * 24 * 60 * 60 * 1000,   // retry not-found sooner
  SUMMARY: 60 * 24 * 60 * 60 * 1000,
  SCHOOL: 180 * 24 * 60 * 60 * 1000,
};

export async function get(key) {
  const k = PREFIX + key;
  const bag = await chrome.storage.local.get(k);
  const rec = bag[k];
  if (!rec) return undefined;
  if (rec.exp && Date.now() > rec.exp) {
    chrome.storage.local.remove(k);
    return undefined;
  }
  return rec.val;
}

export async function set(key, val, ttlMs) {
  const k = PREFIX + key;
  await chrome.storage.local.set({
    [k]: { val, exp: Date.now() + ttlMs, at: Date.now() },
  });
  queuePrune();
}

export async function clear() {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith('c'));
  if (keys.length) await chrome.storage.local.remove(keys);
}

export async function stats() {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith(PREFIX));
  let expired = 0;
  const now = Date.now();
  for (const k of keys) {
    if (all[k]?.exp && now > all[k].exp) expired += 1;
  }
  return { entries: keys.length, expired };
}

let pruneTimer = null;
function queuePrune() {
  if (pruneTimer) return;
  pruneTimer = setTimeout(() => {
    pruneTimer = null;
    prune().catch(() => {});
  }, 5000);
}

async function prune() {
  const all = await chrome.storage.local.get(null);
  const now = Date.now();
  const entries = [];
  const dead = [];

  for (const [k, v] of Object.entries(all)) {
    if (!k.startsWith('c')) continue;
    if (!k.startsWith(PREFIX)) { dead.push(k); continue; }  // old schema
    if (v?.exp && now > v.exp) { dead.push(k); continue; }
    entries.push([k, v?.at || 0]);
  }

  if (entries.length > MAX_ENTRIES) {
    entries.sort((a, b) => a[1] - b[1]);
    dead.push(...entries.slice(0, entries.length - MAX_ENTRIES).map((e) => e[0]));
  }

  if (dead.length) await chrome.storage.local.remove(dead);
}
