export function displayedPosition(
  positionMs: number,
  durationMs: number,
  playing: boolean,
  sampledAtMs: number,
  nowMs: number,
): number {
  const elapsed = playing ? Math.max(0, nowMs - sampledAtMs) : 0;
  return Math.max(0, Math.min(durationMs || Number.POSITIVE_INFINITY, positionMs + elapsed));
}
