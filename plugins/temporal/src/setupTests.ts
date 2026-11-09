import '@testing-library/jest-dom';

// React Flow measures nodes with ResizeObserver and DOMMatrix, which jsdom
// does not have.
class ResizeObserverStub {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback(
      [
        {
          target,
          contentRect: { width: 1000, height: 480 },
        } as unknown as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver ??= ResizeObserverStub;

class DOMMatrixReadOnlyStub {
  m22: number;
  constructor(transform?: string) {
    const scale = transform?.match(/scale\(([0-9.]+)\)/)?.[1];
    this.m22 = scale !== undefined ? Number(scale) : 1;
  }
}
(globalThis as any).DOMMatrixReadOnly ??= DOMMatrixReadOnlyStub;

Object.defineProperties(HTMLElement.prototype, {
  offsetHeight: {
    configurable: true,
    get() {
      return parseFloat(this.style.height) || 64;
    },
  },
  offsetWidth: {
    configurable: true,
    get() {
      return parseFloat(this.style.width) || 220;
    },
  },
});
(SVGElement.prototype as any).getBBox ??= () => ({
  x: 0,
  y: 0,
  width: 0,
  height: 0,
});

// CodeMirror measures text ranges when it scrolls a line into view; jsdom has
// no layout, so ranges report empty boxes.
const emptyRect = () => ({
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  toJSON: () => ({}),
});
(Range.prototype as any).getClientRects ??= () => [];
(Range.prototype as any).getBoundingClientRect ??= emptyRect;
