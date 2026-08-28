// jsdom polyfills for Radix primitives (Select) used by the vendored shadcn components.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-expect-error jsdom global
globalThis.ResizeObserver = globalThis.ResizeObserver ?? ResizeObserverStub;

if (typeof Element !== "undefined") {
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
  // Radix Select probes pointer capture APIs jsdom does not implement.
  // @ts-expect-error augmenting jsdom
  Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture ?? (() => false);
  // @ts-expect-error augmenting jsdom
  Element.prototype.releasePointerCapture = Element.prototype.releasePointerCapture ?? (() => {});
  // @ts-expect-error augmenting jsdom
  Element.prototype.setPointerCapture = Element.prototype.setPointerCapture ?? (() => {});
}
