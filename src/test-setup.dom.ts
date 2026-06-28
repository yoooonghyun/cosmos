/**
 * Global setup for jsdom / React component tests.
 * Imported by vitest.dom.config.ts via setupFiles.
 */
import '@testing-library/jest-dom'

// jsdom ships no ResizeObserver, which Radix primitives (e.g. ScrollArea's `useSize`) construct on
// mount. A no-op polyfill lets components that wrap content in a ScrollArea (the PanelTabTree) render
// under jsdom without crashing the layout-effect commit. Safe + additive for every dom test.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
}
