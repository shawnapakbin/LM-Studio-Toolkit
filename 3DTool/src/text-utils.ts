/**
 * Text utility functions for the 3DTool viewer.
 */

/**
 * Truncates text to a maximum length, appending an ellipsis character ("…")
 * if the text exceeds the specified limit.
 *
 * @param text - The input string to truncate
 * @param maxLength - The maximum number of characters before truncation
 * @returns The original string if its length ≤ maxLength, or the first maxLength characters followed by "…"
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + "\u2026";
}
