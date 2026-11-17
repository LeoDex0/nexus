import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import type { Profile } from '../core/env';

gsap.registerPlugin(ScrollTrigger, SplitText);

/**
 * Scroll reveals. Each kind of element gets its own motion instead of one
 * fade-up everywhere:
 *  - headings: masked line slides
 *  - capability names: the type widens from condensed to expanded
 *  - metrics: numbers count up once
 *  - body copy blocks: a short clip wipe
 */
export function initReveals(profile: Profile) {
  if (profile.reducedMotion) {
    // no counting up: show the final figures straight away
    gsap.utils.toArray<HTMLElement>('[data-count]').forEach((el) => {
      const end = Number(el.dataset.count);
      const dec = Number(el.dataset.decimals ?? 0);
      const sign = end < 0 ? '−' : '';
      el.textContent = `${sign}${Math.abs(end).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })}${el.dataset.suffix ?? ''}`;
    });
    return;
  }

  // masked lines on headings
  gsap.utils.toArray<HTMLElement>('[data-split]').forEach((el) => {
    SplitText.create(el, {
      type: 'lines',
      mask: 'lines',
      linesClass: 'split-line',
      autoSplit: true,
      onSplit: (self) =>
        gsap.from(self.lines, {
          yPercent: 110,
          duration: 1.3,
          stagger: 0.09,
          ease: 'expo.out',
          scrollTrigger: { trigger: el, start: 'top 82%', once: true },
        }),
    });
  });

  // condensed to expanded on the capability names, scrubbed
  gsap.utils.toArray<HTMLElement>('[data-stretch]').forEach((el) => {
    gsap.fromTo(
      el,
      { '--stretch': '75%', letterSpacing: '0.02em' },
      {
        '--stretch': '125%',
        letterSpacing: '-0.04em',
        ease: 'none',
        scrollTrigger: { trigger: el, start: 'top 95%', end: 'top 45%', scrub: 0.6 },
      },
    );
  });

  // counters
  gsap.utils.toArray<HTMLElement>('[data-count]').forEach((el) => {
    const end = Number(el.dataset.count);
    const dec = Number(el.dataset.decimals ?? 0);
    const suffix = el.dataset.suffix ?? '';
    const sign = end < 0 ? '−' : '';
    const state = { v: 0 };
    const render = () => {
      const n = Math.abs(state.v);
      el.textContent = `${sign}${n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })}${suffix}`;
    };
    render();
    gsap.to(state, {
      v: end,
      duration: 1.8,
      ease: 'expo.out',
      onUpdate: render,
      scrollTrigger: { trigger: el, start: 'top 88%', once: true },
    });
  });

  // short clip wipes for copy blocks
  gsap.utils.toArray<HTMLElement>('.cap__text p, .live__intro, .cta__sub, [data-fade]').forEach((el) => {
    gsap.from(el, {
      clipPath: 'inset(0 0 100% 0)',
      y: 18,
      duration: 1.1,
      ease: 'expo.out',
      scrollTrigger: { trigger: el, start: 'top 88%', once: true },
    });
  });

  // capability figures: the frame opens from a hairline
  gsap.utils.toArray<HTMLElement>('.cap__viz').forEach((el) => {
    gsap.from(el, {
      clipPath: 'inset(49.5% 0 49.5% 0)',
      duration: 1.4,
      ease: 'expo.inOut',
      scrollTrigger: { trigger: el, start: 'top 80%', once: true },
    });
  });
}
