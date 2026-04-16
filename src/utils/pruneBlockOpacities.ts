/**
 * Pure utility for pruning an overlay opacity Map when it exceeds a capacity cap.
 *
 * Shared by CameraTranslator and DualStreamView — both maintain a
 * Map<string, Animated.Value> that grows as new OCR text blocks appear on
 * screen. When the map exceeds `cap`, this function evicts entries using a
 * two-phase strategy:
 *
 *   1. **Stale-first sweep** — delete entries whose keys are NOT in the
 *      current `activeIds` set. These blocks are no longer visible, so their
 *      Animated.Values are unreachable and won't be missed.
 *
 *   2. **Oldest-first fallback** — if every entry is still active (or the
 *      sweep didn't free enough space), delete the oldest entry by Map
 *      insertion order.
 *
 * Returns the number of entries pruned so callers can log if needed.
 */
export function pruneBlockOpacities<V>(
  map: Map<string, V>,
  activeIds: ReadonlySet<string>,
  cap: number,
): number {
  if (map.size < cap) return 0;

  let pruned = 0;

  // Phase 1: evict stale entries (not in active set)
  for (const key of map.keys()) {
    if (!activeIds.has(key)) {
      map.delete(key);
      pruned++;
      if (map.size < cap) return pruned;
    }
  }

  // Phase 2: fallback — evict oldest entry by insertion order
  if (map.size >= cap) {
    const firstKey = map.keys().next().value;
    if (firstKey !== undefined) {
      map.delete(firstKey);
      pruned++;
    }
  }

  return pruned;
}
