import { gsap } from 'gsap';
import type { Stage } from '../gl/stage';
import type { Profile } from '../core/env';

export function createLoader() {
  const bar = document.querySelector<HTMLElement>('.loader__line span')!;
  const value = document.querySelector<HTMLElement>('.loader__value')!;
  const state = { p: 0 };
  let target = 0;
  const tween = () =>
    gsap.to(state, {
      p: target,
      duration: 0.6,
      ease: 'power2.out',
      overwrite: true,
      onUpdate: () => {
        bar.style.transform = `scaleX(${state.p})`;
        value.textContent = String(Math.round(state.p * 100)).padStart(3, '0');
      },
    });
  return {
    set(p: number) {
      target = Math.max(target, p);
      return tween();
    },
  };
}

export function runIntro(stage: Stage, profile: Profile, interactive: () => void, done: () => void) {
  const loader = document.querySelector<HTMLElement>('.loader')!;
  const label = loader.querySelector<HTMLElement>('.loader__label')!;
  const lines = gsap.utils.toArray<HTMLElement>('[data-intro="line"]');
  const metas = gsap.utils.toArray<HTMLElement>('[data-intro="meta"]');
  const ledes = gsap.utils.toArray<HTMLElement>('[data-intro="lede"]');
  const letters = gsap.utils.toArray<HTMLElement>('.hero__wordmark span');
  const nav = document.querySelector<HTMLElement>('[data-nav]')!;

  let unlocked = false;
  const unlock = () => {
    if (unlocked) return;
    unlocked = true;
    document.body.classList.remove('is-loading');
    loader.remove();
    interactive();
  };
  const finish = () => {
    unlock();
    done();
  };

  if (profile.reducedMotion) {
    stage.intro = 1;
    finish();
    return;
  }

  gsap.set(lines, { yPercent: 108 });
  gsap.set(letters, { yPercent: 102 });
  gsap.set(metas, { opacity: 0 });
  gsap.set(ledes, { opacity: 0, y: 14 });
  gsap.set(nav, { opacity: 0, y: -12 });

  // scatter the rings so the spring brings them home
  stage.structure.rings.forEach((r, i) => {
    r.angle += (i % 2 ? 1 : -1) * (2.2 + i * 0.6);
    r.vel = (i % 2 ? -1 : 1) * 1.5;
  });

  label.textContent = 'Lattice online';
  const tl = gsap.timeline({ onComplete: finish });
  tl.to('.loader__inner', { opacity: 0, duration: 0.5, ease: 'power2.in' }, 0.15)
    .to('.loader__shutter--top', { yPercent: -100, duration: 1.5, ease: 'expo.inOut' }, 0.35)
    .to('.loader__shutter--bottom', { yPercent: 100, duration: 1.5, ease: 'expo.inOut' }, 0.35)
    .to(stage, { intro: 1, duration: 3.2, ease: 'power3.out' }, 0.45)
    .to(lines, { yPercent: 0, duration: 1.4, stagger: 0.1, ease: 'expo.out' }, 1.15)
    .to(letters, { yPercent: 0, duration: 1.6, stagger: 0.07, ease: 'expo.out' }, 1.0)
    .to(nav, { opacity: 1, y: 0, duration: 1.2, ease: 'expo.out' }, 1.4)
    .to(metas, { opacity: 1, duration: 0.9, stagger: 0.06, ease: 'power2.out' }, 1.6)
    .to(ledes, { opacity: 1, y: 0, duration: 1.2, stagger: 0.1, ease: 'expo.out' }, 1.8)
    // the page can be scrolled before the last settle finishes
    .call(unlock, [], 1.9);
}
