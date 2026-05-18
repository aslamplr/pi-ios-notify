/**
 * Pure utility functions extracted for testability.
 */

/**
 * Truncate a prompt string to at most 120 characters.
 * Appends "…" when truncated.
 */
export function formatPrompt(prompt: string): string {
  const max = 120;
  if (prompt.length <= max) return prompt;
  return prompt.slice(0, max) + "…";
}

/**
 * Simple pluralization helper.
 * Returns `singular` when n === 1, otherwise `plural` or `singular + "s"`.
 */
export function pluralize(n: number, singular: string, plural?: string): string {
  return n === 1 ? singular : plural ?? singular + "s";
}

/**
 * Convert a boolean to "on" or "off".
 */
export function onOff(v: boolean): string {
  return v ? "on" : "off";
}

/**
 * Parse common truthy/falsy string representations into a boolean.
 * Returns `undefined` for unrecognized or empty input.
 */
export function parseBool(s: string | undefined): boolean | undefined {
  if (!s) return undefined;
  if (s === "true" || s === "on" || s === "yes" || s === "1") return true;
  if (s === "false" || s === "off" || s === "no" || s === "0") return false;
  return undefined;
}
