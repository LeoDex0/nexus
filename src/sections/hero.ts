import { gsap } from 'gsap';
import type { Stage } from '../gl/stage';
import { PARTS } from '../gl/structure';
import type { Profile } from '../core/env';
import { pointer } from '../core/env';

/** Fits the NEXUS wordmark to the full content width. */
export function fitWordmark() {
  const wm = document.querySelector<HTMLElement>('.hero__wordmark')!;
  const letters = [...wm.querySelectorAll<HTMLElement>('span')];
  wm.style.setProperty('--wm-size', '100px');
  const sum = letters.reduce((a, l) => a + l.getBoundingClientRect().width, 0);
  const avail = wm.clientWidth;
  const size = (100 * avail * (innerWidth < 720 ? 0.97 : 0.9)) / sum;
  wm.style.setProperty('--wm-size', `${size.toFixed(2)}px`);
  document.documentElement.style.setProperty('--wm-h', `${(size * 0.87).toFixed(1)}px`);
}

export function initHero(stage: Stage, profile: Profile) {
  const hero = document.querySelector<HTMLElement>('.hero')!;
  const holdBtn = hero.querySelector<HTMLButtonElement>('[data-hold]')!;
  const inspectBtn = hero.querySelector<HTMLButtonElement>('[data-inspect]')!;
  const inspectText = inspectBtn.querySelector<HTMLElement>('.hero__inspect-text')!;
  const result = hero.querySelector<HTMLElement>('.hero__result')!;
  const hud = document.querySelector<HTMLElement>('.hud')!;
  const hudRing = hud.querySelector<SVGCircleElement>('circle')!;
  const hudPct = hud.querySelector<HTMLElement>('b')!;
  const tip = document.querySelector<HTMLElement>('.part-tip')!;
  const tipName = tip.querySelector<HTMLElement>('.part-tip__name')!;
  const tipSpec = tip.querySelector<HTMLElement>('.part-tip__spec')!;
  const clock = hero.querySelector<HTMLElement>('[data-clock]')!;
  const cycle = hero.querySelector<HTMLElement>('[data-cycle]')!;

  fitWordmark();
  window.addEventListener('resize', fitWordmark);
  document.fonts?.ready.then(fitWordmark);

  // live readouts
  const tickClock = () => {
    clock.textContent = new Date().toISOString().slice(11, 19);
  };
  tickClock();
  setInterval(tickClock, 1000);
  setInterval(() => {
    const v = 0.39 + Math.random() * 0.05 + stage.charge * 0.3;
    cycle.textContent = `${v.toFixed(2)} ms`;
  }, 700);

  /* ---- inspect mode ------------------------------------------------------ */
  const setInspect = (on: boolean) => {
    stage.toggleInspect(on);
    inspectBtn.setAttribute('aria-pressed', String(on));
    inspectText.textContent = on ? 'Reassemble' : 'Inspect the core';
  };
  inspectBtn.addEventListener('click', () => setInspect(!stage.inspecting));
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && stage.inspecting) setInspect(false);
  });
  // the story ends inspect mode when the hero is left; keep the button in sync
  let lastInspecting = false;
  gsap.ticker.add(() => {
    if (stage.inspecting !== lastInspecting) {
      lastInspecting = stage.inspecting;
      if (!stage.inspecting) setInspect(false);
    }
  });

  /* ---- part tooltip ------------------------------------------------------ */
  let tipPart = -1;
  let tipTimer = 0;
  const showTip = (part: number, x: number, y: number) => {
    tipPart = part;
    const info = PARTS[part];
    if (!info || stage.mode !== 'hero') {
      tip.classList.remove('is-on');
      document.body.style.cursor = part >= 0 && stage.pickable ? 'pointer' : '';
      return;
    }
    tipName.textContent = info.name;
    tipSpec.textContent = info.spec;
    tip.classList.add('is-on');
    placeTip(x, y);
    document.body.style.cursor = 'pointer';
  };
  const placeTip = (x: number, y: number) => {
    const w = tip.offsetWidth;
    const left = x + 18 + w > innerWidth - 12 ? x - 18 - w : x + 18;
    tip.style.transform = `translate3d(${left}px, ${y + 16}px, 0)`;
  };
  stage.onHover = (part) => {
    if (part < 0) {
      tipPart = -1;
      tip.classList.remove('is-on');
      document.body.style.cursor = '';
    } else showTip(part, pointer.clientX, pointer.clientY);
  };
  window.addEventListener('pointermove', (e) => {
    if (tipPart >= 0 && e.pointerType === 'mouse') placeTip(e.clientX, e.clientY);
  });

  /* ---- hold to compute, click to inspect, drag to turn ------------------- */
  let holdSource: 'pointer' | 'button' | 'key' | null = null;
  let downX = 0;
  let downY = 0;
  let downAt = 0;
  let dragging = false;
  let pressing = false;
  let pressType = 'mouse';
  let lastX = 0;
  let count = 0;
  let hudX = innerWidth / 2;
  let hudY = innerHeight / 2;
  let holdDelay = 0;

  const inHero = () => hero.getBoundingClientRect().bottom > innerHeight * 0.5;

  const start = (src: typeof holdSource) => {
    if (holdSource) return;
    holdSource = src;
    stage.holding = true;
    holdBtn.classList.add('is-holding');
    // from the button the ring sits around its key and the label shows in the button
    hud.classList.toggle('hud--button', src !== 'pointer');
    if (src !== 'pointer') {
      const r = holdBtn.getBoundingClientRect();
      hudX = r.left + 13;
      hudY = r.top + r.height / 2;
    }
  };
  const end = () => {
    if (!holdSource) return;
    holdSource = null;
    stage.holding = false;
    holdBtn.classList.remove('is-holding');
  };

  hero.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('a, button, input')) return;
    pressing = true;
    pressType = e.pointerType;
    downX = lastX = e.clientX;
    downY = e.clientY;
    downAt = performance.now();
    dragging = false;
    // a short press is a click; only a held press starts computing
    if (e.pointerType === 'mouse') holdDelay = window.setTimeout(() => !dragging && pressing && start('pointer'), 200);
  });
  window.addEventListener('pointermove', (e) => {
    if (!pressing) return;
    const dx = e.clientX - downX;
    const dy = e.clientY - downY;
    if (!dragging && Math.hypot(dx, dy) > 8 && (pressType === 'mouse' || Math.abs(dx) > Math.abs(dy) * 1.3)) {
      dragging = true;
      clearTimeout(holdDelay);
      end();
    }
    if (dragging) {
      stage.drag((e.clientX - lastX) / innerWidth);
      lastX = e.clientX;
    }
  });
  window.addEventListener('pointerup', (e) => {
    if (!pressing) return;
    pressing = false;
    clearTimeout(holdDelay);
    const wasHold = holdSource === 'pointer';
    end();
    if (dragging || wasHold || performance.now() - downAt > 450) return;
    // a click (or tap): on the object it toggles inspect, elsewhere it reassembles
    const part = stage.pick((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    if (part >= 0) {
      setInspect(!stage.inspecting);
      if (e.pointerType !== 'mouse') {
        showTip(part, e.clientX, e.clientY);
        clearTimeout(tipTimer);
        tipTimer = window.setTimeout(() => stage.onHover?.(-1), 2200);
      }
    } else if (stage.inspecting) setInspect(false);
  });
  window.addEventListener('pointercancel', () => {
    pressing = false;
    clearTimeout(holdDelay);
    end();
  });
  window.addEventListener('blur', end);

  // the hold button: works for touch and pointer; keyboard via Space / Enter
  holdBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    holdBtn.setPointerCapture(e.pointerId);
    start('button');
  });
  holdBtn.addEventListener('pointerup', end);
  holdBtn.addEventListener('pointercancel', end);
  holdBtn.addEventListener('contextmenu', (e) => e.preventDefault());
  holdBtn.addEventListener('keydown', (e) => {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
      e.preventDefault();
      start('key');
    }
  });
  holdBtn.addEventListener('keyup', (e) => {
    if (e.key === ' ' || e.key === 'Enter') end();
  });
  holdBtn.addEventListener('click', (e) => e.preventDefault());

  const holdText = holdBtn.querySelector<HTMLElement>('.hero__hold-text')!;
  const idleText = holdText.textContent;
  let shownPct = -1;
  stage.onCharge = (c) => {
    holdBtn.style.setProperty('--hold', String(0.35 + c * 0.65));
    const pct = holdSource && holdSource !== 'pointer' && c > 0.01 ? Math.round(c * 100) : -1;
    if (pct !== shownPct) {
      shownPct = pct;
      holdText.textContent = pct >= 0 ? `Computing ${pct}%` : idleText;
    }
    const show = c > 0.01 && inHero();
    if (holdSource === 'pointer' && !dragging) {
      hudX = pointer.clientX;
      hudY = pointer.clientY;
    }
    hud.style.opacity = show ? String(Math.min(1, c * 4)) : '0';
    if (show) {
      hud.style.transform = `translate3d(${hudX}px, ${hudY}px, 0)`;
      hudRing.style.strokeDashoffset = String(1 - c);
      hudPct.textContent = String(Math.round(c * 100));
    }
  };

  stage.onResolve = (ms) => {
    count++;
    const id = Math.floor(Math.random() * 0xffff)
      .toString(16)
      .toUpperCase()
      .padStart(4, '0');
    result.textContent = `Configuration ${id} computed in ${(ms / 1000).toFixed(2)} s${count > 1 ? ` · ${count} this visit` : ''}`;
    gsap.fromTo(result, { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: 0.9, ease: 'expo.out' });
    if (!profile.reducedMotion) {
      gsap.fromTo('.hero__wordmark span', { yPercent: 0 }, { yPercent: -4, duration: 0.18, stagger: 0.03, ease: 'power2.out', yoyo: true, repeat: 1 });
    }
  };

  // ---- scroll exit (created after the intro so start values are final) ---
  return {
    enableScrollExit() {
      if (profile.reducedMotion) return;
      gsap
        .timeline({ scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true, invalidateOnRefresh: true } })
        .to('.hero__title, .hero__lede, .hero__controls', { y: -80, opacity: 0, ease: 'none' }, 0)
        .to('.hero__meta, .hero__status, .hero__scroll', { opacity: 0, ease: 'none', duration: 0.5 }, 0)
        // y (pixels) here, yPercent in the intro: the two never fight
        .to('.hero__wordmark span', { y: (_i: number, el: HTMLElement) => el.offsetHeight * 0.7, ease: 'none', stagger: 0.04 }, 0);
    },
  };
}
