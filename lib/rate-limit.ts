interface Entry {
  count: number;
  resetsAt: number;
}

const entries = new Map<string, Entry>();

export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const existing = entries.get(key);
  if (!existing || existing.resetsAt <= now) {
    entries.set(key, { count: 1, resetsAt: now + windowMs });
    return true;
  }
  if (existing.count >= limit) return false;
  existing.count += 1;
  return true;
}

