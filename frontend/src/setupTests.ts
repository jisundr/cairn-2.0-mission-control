import "@testing-library/jest-dom/vitest";

// jsdom has no layout engine (every element reports 0 size) and no
// ResizeObserver at all - @tanstack/react-virtual (the Drilldown page's
// virtualized transcript) needs both to compute a non-empty visible
// range. Without these, every virtualized test would see an empty
// scroll container regardless of how much data it was given.
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 800 });
Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, value: 800 });
