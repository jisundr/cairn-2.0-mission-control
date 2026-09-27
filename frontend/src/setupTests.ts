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

// Recharts' <ResponsiveContainer> (goals 3-6) measures its container via
// `getBoundingClientRect()` on mount, not `offsetWidth`/`offsetHeight` -
// jsdom has no layout engine, so that always reports an all-zero rect,
// which Recharts then refuses to render into (a zero-size chart is treated
// as "wait for a resize event that never comes" under the ResizeObserver
// stub above). Same fixed non-zero size as the offset* stubs, so every
// chart gets a stable, non-zero area to lay out into under test.
Element.prototype.getBoundingClientRect = () =>
  ({ x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 800, width: 800, height: 800, toJSON() {} }) as DOMRect;
