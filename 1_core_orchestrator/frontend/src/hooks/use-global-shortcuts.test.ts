import { describe, expect, it, vi } from "vitest";

import { matchesShortcutEvent } from "./use-global-shortcuts";

describe("matchesShortcutEvent", () => {
  const baseShortcut = {
    key: "k",
    meta: true,
    action: vi.fn(),
  };

  it("ignores malformed keyboard events without throwing", () => {
    expect(
      matchesShortcutEvent(
        {
          key: undefined,
          metaKey: true,
          ctrlKey: false,
          shiftKey: false,
          isComposing: false,
        },
        baseShortcut,
      ),
    ).toBe(false);
  });

  it("skips shortcut matching while IME composition is active", () => {
    expect(
      matchesShortcutEvent(
        {
          key: "Process",
          metaKey: true,
          ctrlKey: false,
          shiftKey: false,
          isComposing: true,
        },
        baseShortcut,
      ),
    ).toBe(false);
  });

  it("matches case-insensitively for ctrl/cmd shortcuts", () => {
    expect(
      matchesShortcutEvent(
        {
          key: "K",
          metaKey: false,
          ctrlKey: true,
          shiftKey: false,
          isComposing: false,
        },
        baseShortcut,
      ),
    ).toBe(true);
  });
});