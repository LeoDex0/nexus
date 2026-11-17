import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import type { Profile } from './env';

gsap.registerPlugin(ScrollTrigger);

export interface Scroller {
  lenis: Lenis | null;
  y: () => number;
  to: (target: string | number | HTMLElement, opts?: { immediate?: boolean; offset?: number }) => void;
  stop: () => void;
  start: () => void;
}

export function initScroll(profile: Profile): Scroller {
  ScrollTrigger.config({ ignoreMobileResize: true });
  if (profile.reducedMotion) {
    return {
      lenis: null,
      y: () => scrollY,
      to: (target, opts) => {
        const el = typeof target === 'string' ? document.querySelector(target) : target;
        const top = typeof el === 'number' ? el : el instanceof HTMLElement ? el.getBoundingClientRect().top + scrollY + (opts?.offset ?? 0) : 0;
        window.scrollTo({ top, behavior: 'auto' });
      },
      stop: () => (document.body.style.overflow = 'hidden'),
      start: () => (document.body.style.overflow = ''),
    };
  }

  const lenis = new Lenis({
    autoRaf: false,
    lerp: 0.09,
    wheelMultiplier: 0.9,
    syncTouch: false,
  });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);

  return {
    lenis,
    y: () => lenis.scroll,
    to: (target, opts) => lenis.scrollTo(target as never, { immediate: opts?.immediate, offset: opts?.offset ?? 0, duration: 1.6, easing: (t) => 1 - Math.pow(1 - t, 4) }),
    stop: () => lenis.stop(),
    start: () => lenis.start(),
  };
}
