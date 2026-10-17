/**
 * Pure formatters for Awuuu dashboard and notch modules.
 * Strictly pure logic, no DOM dependencies.
 */

/**
 * Formats a duration in milliseconds to "m:ss" (e.g. 65000 -> "1:05").
 * Negative values, NaN, and Infinity clamp to "0:00".
 */
export function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0:00";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Builds a text-based progress bar for percentage values.
 * e.g. pctBar(0, 10) === "░░░░░░░░░░"
 *      pctBar(50, 10) === "█████░░░░░"
 *      pctBar(150, 10) === "██████████"
 */
export function pctBar(value: number, width: number): string {
  if (!Number.isFinite(width) || width <= 0) return "";
  const safeVal = Number.isFinite(value) ? value : 0;
  const clampedVal = Math.max(0, Math.min(100, safeVal));
  const filled = Math.max(0, Math.min(width, Math.round((clampedVal / 100) * width)));
  const empty = width - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}
