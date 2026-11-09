import { afterEach } from "vitest";
import { cleanup } from "@testing-library/svelte";

// Testing Library only auto-cleans when vitest globals are enabled; this project
// keeps globals off, so unmount explicitly after each test.
afterEach(() => cleanup());

// jsdom implements no matchMedia, but the app's motion helpers read it to honour
// prefers-reduced-motion. Default to "no preference" so transitions run.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// jsdom has no Web Animations API; Svelte transitions call element.animate().
// Resolve immediately so transitions complete within the test's microtasks.
if (typeof Element !== "undefined" && typeof Element.prototype.animate !== "function") {
  Element.prototype.animate = function (): Animation {
    const animation = {
      currentTime: 0,
      playState: "running",
      onfinish: null as null | (() => void),
      finished: Promise.resolve(),
      cancel() {},
      finish() {
        this.onfinish?.();
      },
      addEventListener() {},
      removeEventListener() {},
    };
    queueMicrotask(() => animation.onfinish?.());
    return animation as unknown as Animation;
  };
}
