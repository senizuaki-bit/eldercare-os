import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

vi.mock('echarts', () => ({
  init: () => ({
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn()
  })
}));

class ResizeObserverMock implements ResizeObserver {
  disconnect(): void {
    return undefined;
  }

  observe(): void {
    return undefined;
  }

  unobserve(): void {
    return undefined;
  }
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true,
  value: ResizeObserverMock
});

Object.defineProperty(globalThis, 'matchMedia', {
  configurable: true,
  value: (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false
  })
});

Object.defineProperty(Element.prototype, 'scrollIntoView', {
  configurable: true,
  value: vi.fn()
});

const nativeGetComputedStyle = window.getComputedStyle.bind(window);
Object.defineProperty(window, 'getComputedStyle', {
  configurable: true,
  value: (element: Element): CSSStyleDeclaration => nativeGetComputedStyle(element)
});
