/** Merge server-written log entries into the local list: dedupe by id, newest first. */
export function mergeLogEntries(local, incoming, max = 500) {
  if (!incoming?.length) return local
  const seen = new Set(local.map((e) => e.id))
  const fresh = incoming.filter((e) => e && e.id && !seen.has(e.id))
  if (!fresh.length) return local
  return [...fresh, ...local].sort((a, b) => b.timestamp - a.timestamp).slice(0, max)
}
