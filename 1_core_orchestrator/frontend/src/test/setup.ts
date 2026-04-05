import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

class ResizeObserverMock {
  observe() {
    return undefined;
  }

  unobserve() {
    return undefined;
  }

  disconnect() {
    return undefined;
  }
}

Object.defineProperty(globalThis, "ResizeObserver", {
  writable: true,
  value: ResizeObserverMock,
});

Object.defineProperty(globalThis, "alert", {
  writable: true,
  value: vi.fn(),
});

Object.defineProperty(globalThis.URL, "createObjectURL", {
  writable: true,
  value: vi.fn(() => "blob:test"),
});

Object.defineProperty(globalThis.URL, "revokeObjectURL", {
  writable: true,
  value: vi.fn(),
});

Object.defineProperty(HTMLAnchorElement.prototype, "click", {
  writable: true,
  value: vi.fn(),
});