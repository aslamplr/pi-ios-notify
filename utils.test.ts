import { describe, it, expect } from "vitest";
import { formatPrompt, pluralize, onOff, parseBool } from "./utils.js";

// ── formatPrompt ───────────────────────────────────────────────────

describe("formatPrompt", () => {
  it("returns short prompts unchanged", () => {
    expect(formatPrompt("hello")).toBe("hello");
  });

  it("returns prompts at exactly 120 chars unchanged", () => {
    const s = "a".repeat(120);
    expect(formatPrompt(s)).toBe(s);
  });

  it("truncates prompts longer than 120 chars with …", () => {
    const s = "a".repeat(150);
    const result = formatPrompt(s);
    expect(result).toBe("a".repeat(120) + "…");
    expect(result.length).toBe(121);
  });

  it("handles empty string", () => {
    expect(formatPrompt("")).toBe("");
  });

  it("handles special characters", () => {
    const s = "refactor the auth module to use JWT tokens and add tests " + "x".repeat(100);
    const result = formatPrompt(s);
    expect(result).toHaveLength(121);
    expect(result.endsWith("…")).toBe(true);
  });
});

// ── pluralize ──────────────────────────────────────────────────────

describe("pluralize", () => {
  it("returns singular for n === 1", () => {
    expect(pluralize(1, "turn", "turns")).toBe("turn");
  });

  it("returns plural for n === 0", () => {
    expect(pluralize(0, "turn", "turns")).toBe("turns");
  });

  it("returns plural for n > 1", () => {
    expect(pluralize(5, "turn", "turns")).toBe("turns");
  });

  it("auto-pluralizes with s when no plural given", () => {
    expect(pluralize(2, "apple")).toBe("apples");
  });

  it("auto-pluralizes correctly for n === 1 without plural", () => {
    expect(pluralize(1, "apple")).toBe("apple");
  });
});

// ── onOff ──────────────────────────────────────────────────────────

describe("onOff", () => {
  it("returns 'on' for true", () => {
    expect(onOff(true)).toBe("on");
  });

  it("returns 'off' for false", () => {
    expect(onOff(false)).toBe("off");
  });
});

// ── parseBool ──────────────────────────────────────────────────────

describe("parseBool", () => {
  // Truthy values
  it.each(["true", "on", "yes", "1"])("parses '%s' as true", (s) => {
    expect(parseBool(s)).toBe(true);
  });

  // Falsy values
  it.each(["false", "off", "no", "0"])("parses '%s' as false", (s) => {
    expect(parseBool(s)).toBe(false);
  });

  // Edge cases
  it("returns undefined for empty string", () => {
    expect(parseBool("")).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    expect(parseBool(undefined)).toBeUndefined();
  });

  it("returns undefined for unknown strings", () => {
    expect(parseBool("maybe")).toBeUndefined();
  });

  it("is case-sensitive (lowercase only)", () => {
    expect(parseBool("True")).toBeUndefined();
    expect(parseBool("ON")).toBeUndefined();
  });

  it("handles whitespace literally (no trim)", () => {
    expect(parseBool(" true")).toBeUndefined();
  });
});
