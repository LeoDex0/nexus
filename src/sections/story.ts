import { gsap } from 'gsap';
import type { Stage } from '../gl/stage';
import { Callouts } from '../gl/callouts';
import { RING_DEFS } from '../gl/structure';
import type { Scroller } from '../core/scroll';
import { clamp, invLerp } from '../util/math';

interface Box {
  top: number;
  h: number;
}

/** Architecture layer each pickable part belongs to (see Structure.pickables). */
const PART_LAYER = [...RING_DEFS.map((d) => d.layer), 2, 0, 4];

/**
 * Drives the persistent 3D stage from the scroll position: which pose it
 * is in, how visible it is, and the callouts that annotate it.
 */
export function initStory(stage: Stage, scroll: Scroller) {
  const svg = document.querySelector<SVGSVGElement>('.overlay__svg')!;
  const coreHost = document.querySelector<HTMLElement>('.overlay__labels--core')!;
  const archHost = document.querySelector<HTMLElement>('.overlay__labels--arch')!;

  const coreCallouts = new Callouts(
    coreHost,
    svg,
    [
      { key: 'lattice', title: 'Photonic lattice', sub: '4,096 nodes in fused silica', side: 'r' },
      { key: 'energy', title: 'Ring / energy', sub: 'Titanium bezel with a light channel', side: 'l' },
      { key: 'time', title: 'Ring / time', sub: '16 anodised segments', side: 'r' },
      { key: 'bearing', title: 'Magnetic bearing', sub: 'Contact-free, 0.2 µm play', side: 'l' },
      { key: 'risk', title: 'Ring / risk', sub: 'Titanium truss, 48 struts', side: 'r' },
      { key: 'space', title: 'Ring / space', sub: 'Chrome gear, 120 teeth', side: 'l' },
      { key: 'intent', title: 'Ring / intent', sub: 'Six optical relays', side: 'r' },
    ],
    stage,
  );
  const archCallouts = new Callouts(
    archHost,
    svg,
    [
      { key: 'layer0', title: 'Substrate', sub: 'Photonic interconnect', side: 'r' },
      { key: 'layer1', title: 'Fabric', sub: 'Distributed memory', side: 'r' },
      { key: 'layer2', title: 'Lattice', sub: 'Reasoning core', side: 'r' },
      { key: 'layer3', title: 'Context', sub: 'Time, space, risk', side: 'r' },
      { key: 'layer4', title: 'Interface', sub: 'Human intent and limits', side: 'r' },
    ],
    stage,
  );
  archCallouts.column = 'stack';
  archCallouts.reveal(5);

  const el = {
    core: document.getElementById('core')!,
    intel: document.getElementById('intelligence')!,
    arch: document.getElementById('architecture')!,
    caps: document.getElementById('capabilities')!,
    cta: document.getElementById('cta')!,
  };
  const corePin = el.core.querySelector<HTMLElement>('.core__pin')!;
  const box: Record<keyof typeof el, Box> = {} as never;
  const measure = () => {
    for (const k of Object.keys(el) as (keyof typeof el)[]) {
      const r = el[k].getBoundingClientRect();
      box[k] = { top: r.top + scroll.y(), h: r.height };
    }
  };
  measure();
  window.addEventListener('resize', () => requestAnimationFrame(measure));
  new ResizeObserver(() => measure()).observe(document.body);

  /* ---- architecture: selection by scroll, index buttons or clicking a layer */
  const indexItems = [...document.querySelectorAll<HTMLButtonElement>('.arch__index button')];
  const layers = [...document.querySelectorAll<HTMLElement>('.arch__layer')];
  let shownLayer = -1;
  const showLayer = (i: number) => {
    if (i === shownLayer) return;
    const prev = layers[shownLayer];
    shownLayer = i;
    indexItems.forEach((b, k) => {
      b.classList.toggle('is-active', k === i);
      b.setAttribute('aria-current', k === i ? 'step' : 'false');
    });
    const next = layers[i];
    if (prev) {
      gsap.killTweensOf(prev);
      gsap.to(prev, { autoAlpha: 0, y: -16, duration: 0.35, ease: 'power2.in' });
    }
    gsap.killTweensOf(next);
    gsap.fromTo(next, { autoAlpha: 0, y: 22, clipPath: 'inset(0 0 100% 0)' }, { autoAlpha: 1, y: 0, clipPath: 'inset(0 0 0% 0)', duration: 0.8, ease: 'expo.out', delay: prev ? 0.2 : 0 });
  };
  showLayer(0);
  const scrollToLayer = (i: number) => {
    const y = box.arch.top + ((i + 0.5) / 5) * Math.max(1, box.arch.h - innerHeight);
    scroll.to(y);
  };
  indexItems.forEach((b, i) => b.addEventListener('click', () => scrollToLayer(i)));
  el.arch.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('button, a')) return;
    if (stage.mode !== 'arch') return;
    const part = stage.pick((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    if (part >= 0) scrollToLayer(PART_LAYER[part]);
  });

  /* ---- core specs: hairlines draw then values appear, once ------------- */
  const specs = document.querySelector<HTMLElement>('[data-specs]')!;
  const rows = [...specs.querySelectorAll<HTMLElement>('div')];
  gsap.set(rows, { '--draw': 0 });
  gsap.set(specs.querySelectorAll('dt, dd'), { opacity: 0 });
  let specsShown = false;

  const mobile = () => innerWidth <= 900;
  let inspectClass = false;

  const update = (dt: number) => {
    const y = scroll.y();
    const vh = innerHeight;

    // 3D pose + visibility
    const heroToCore = invLerp(box.core.top - vh, box.core.top - vh * 0.1, y);
    const coreEnd = box.core.top + box.core.h;
    // end of the pinned core section: the camera dives into the lattice
    const dive = mobile() || y >= box.intel.top ? 0 : invLerp(coreEnd - vh * 1.32, coreEnd - vh * 0.92, y);
    const coreOut = invLerp(box.intel.top - vh, box.intel.top - vh * 0.35, y);
    const archIn = invLerp(box.arch.top - vh * 0.85, box.arch.top - vh * 0.05, y);
    const archEnd = box.arch.top + box.arch.h;
    const archOut = invLerp(archEnd - vh, archEnd - vh * 0.45, y);
    const ctaIn = invLerp(box.cta.top - vh * 0.9, box.cta.top - vh * 0.1, y);

    let vis: number;
    if (y < box.intel.top) {
      stage.setMode('hero');
      vis = 1 - coreOut;
    } else if (y < box.caps.top) {
      stage.setMode('arch');
      vis = archIn * (1 - archOut);
    } else {
      stage.setMode('cta');
      vis = ctaIn * 0.82;
    }
    stage.heroToCore = heroToCore;
    stage.dive = dive;
    stage.setVisibility(vis);
    corePin.style.setProperty('--dive', String(dive));

    // leaving the hero ends inspect mode
    if (stage.inspecting && heroToCore > 0.25) stage.toggleInspect(false);
    const inspectingHero = stage.inspect > 0.05 && heroToCore < 0.25;
    if (inspectingHero !== inspectClass) {
      inspectClass = inspectingHero;
      document.body.classList.toggle('is-inspecting', inspectingHero);
    }

    stage.pickable =
      (stage.mode === 'hero' && vis > 0.6 && dive < 0.05 && (heroToCore < 0.05 || heroToCore > 0.95)) ||
      (stage.mode === 'arch' && archIn > 0.95 && archOut < 0.15);

    // core callouts: one by one through the pinned core, all at once when inspecting
    const coreP = invLerp(box.core.top - vh * 0.25, box.core.top + box.core.h - vh * 1.45, y);
    if (stage.mode === 'hero' && heroToCore < 0.3) {
      coreCallouts.range = { l: [0.13, 0.47], r: [0.13, 0.88] };
      coreCallouts.reveal(stage.inspect > 0.6 && !mobile() ? 7 : 0);
      coreCallouts.update(dt, stage.inspect > 0.6);
    } else {
      coreCallouts.range = { l: [0.38, 0.72], r: [0.18, 0.66] };
      coreCallouts.reveal(mobile() ? 0 : Math.floor(coreP * 8.5));
      coreCallouts.update(dt, stage.mode === 'hero' && heroToCore > 0.85 && dive < 0.08 && vis > 0.3);
    }

    if (!specsShown && y > box.core.top - vh * 0.35) {
      specsShown = true;
      gsap.to(rows, { '--draw': 1, duration: 1.1, stagger: 0.08, ease: 'expo.out' });
      gsap.to(specs.querySelectorAll('dt, dd'), { opacity: 1, duration: 0.6, stagger: 0.04, delay: 0.3 });
    }

    // architecture: five steps across the pinned section
    const archP = clamp((y - box.arch.top) / Math.max(1, box.arch.h - vh));
    const step = Math.min(4, Math.floor(archP * 5));
    stage.layer += (step - stage.layer) * Math.min(1, dt * 6);
    showLayer(step);
    archCallouts.active = step;
    // narrower screens: the index on the left already names the layers
    archCallouts.update(dt, innerWidth >= 1200 && stage.mode === 'arch' && archIn > 0.9 && archOut < 0.3);
  };

  return { update, measure };
}
