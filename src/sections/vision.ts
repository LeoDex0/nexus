import { gsap } from 'gsap';
import { RING_DEFS } from '../gl/structure';
import type { Profile } from '../core/env';

const NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent: SVGElement) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent.appendChild(e);
  return e;
}

/** Builds the plan + elevation drawing of the core from the real ring dimensions. */
function buildDrawing(svg: SVGSVGElement) {
  const g = el('g', {}, svg);
  const cx = 300;
  const planY = 190;
  const S = 70; // px per unit
  const line = (cls: string, d: Record<string, string | number>, tag: 'line' | 'circle' | 'rect' | 'path' | 'polygon' = 'line') => el(tag, { class: cls, pathLength: 1, ...d }, g);

  // centre lines
  line('d-dash', { x1: cx - 190, y1: planY, x2: cx + 190, y2: planY });
  line('d-dash', { x1: cx, y1: planY - 190, x2: cx, y2: 590 });

  // plan: every ring as two circles
  for (const r of RING_DEFS) {
    line('d-line', { cx, cy: planY, r: r.rOut * S }, 'circle');
    line('d-thin', { cx, cy: planY, r: r.rIn * S }, 'circle');
  }
  // core: hexagonal silhouette of the icosahedron
  const hex = Array.from({ length: 6 }, (_, k) => {
    const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
    return `${cx + Math.cos(a) * 0.64 * S},${planY + Math.sin(a) * 0.64 * S}`;
  }).join(' ');
  line('d-accent', { points: hex }, 'polygon');
  // bezel ticks
  const r0 = RING_DEFS[0];
  for (let k = 0; k < 72; k++) {
    const a = (k / 72) * Math.PI * 2;
    const len = k % 6 === 0 ? 9 : 4;
    const ro = r0.rOut * S - 2;
    line('d-thin', { x1: cx + Math.cos(a) * ro, y1: planY + Math.sin(a) * ro, x2: cx + Math.cos(a) * (ro - len), y2: planY + Math.sin(a) * (ro - len) });
  }
  // diameter dimension
  const dimY = planY - r0.rOut * S - 22;
  line('d-thin', { x1: cx - r0.rOut * S, y1: dimY, x2: cx + r0.rOut * S, y2: dimY });
  line('d-thin', { x1: cx - r0.rOut * S, y1: dimY - 5, x2: cx - r0.rOut * S, y2: dimY + 5 });
  line('d-thin', { x1: cx + r0.rOut * S, y1: dimY - 5, x2: cx + r0.rOut * S, y2: dimY + 5 });
  el('text', { x: cx, y: dimY - 8, 'text-anchor': 'middle', class: 'd-text' }, g).textContent = `Ø ${Math.round(r0.rOut * 2 * 1000)}`;
  el('text', { x: cx - 190, y: planY - 160, class: 'd-text' }, g).textContent = 'Plan';

  // elevation: the stacked architecture, side on
  const baseY = 560;
  const E = 46;
  const layers: [number, number, number, boolean][] = [
    // half-width, y, height, accent
    [2.32, -1.95, 0.08, false],
    [RING_DEFS[0].rOut, -1.32, RING_DEFS[0].h, false],
    [RING_DEFS[1].rOut, -0.92, RING_DEFS[1].h, false],
    [RING_DEFS[2].rOut, 0.72, RING_DEFS[2].h, false],
    [RING_DEFS[3].rOut, 1.1, RING_DEFS[3].h, false],
    [RING_DEFS[4].rOut, 1.55, RING_DEFS[4].h, false],
    [0.79, 1.87, 0.05, true],
  ];
  const yOf = (y: number) => baseY - (y + 2.0) * E * 0.62;
  for (const [hw, y, h, acc] of layers) {
    line(acc ? 'd-accent' : 'd-line', { x: cx - hw * E, y: yOf(y) - (h * E) / 2, width: hw * 2 * E, height: Math.max(1.5, h * E) }, 'rect');
  }
  // core diamond in elevation
  const cy2 = yOf(-0.1);
  line('d-accent', { points: `${cx},${cy2 - 0.64 * E * 0.8} ${cx + 0.6 * E},${cy2} ${cx},${cy2 + 0.64 * E * 0.8} ${cx - 0.6 * E},${cy2}` }, 'polygon');
  // height dimension
  const top = yOf(1.87) - 2;
  const bot = yOf(-1.95) + 2;
  const dx = cx + 2.32 * E + 24;
  line('d-thin', { x1: dx, y1: top, x2: dx, y2: bot });
  line('d-thin', { x1: dx - 5, y1: top, x2: dx + 5, y2: top });
  line('d-thin', { x1: dx - 5, y1: bot, x2: dx + 5, y2: bot });
  el('text', { x: dx + 10, y: (top + bot) / 2, class: 'd-text' }, g).textContent = '3820';
  el('text', { x: cx - 190, y: top - 14, class: 'd-text' }, g).textContent = 'Elevation A–A';
  return g;
}

export function initVision(profile: Profile) {
  const section = document.getElementById('vision')!;
  const plate = section.querySelector<HTMLElement>('.vision__plate')!;
  const svg = section.querySelector<SVGSVGElement>('[data-drawing]')!;
  const g = buildDrawing(svg);
  const strokes = [...g.querySelectorAll<SVGGeometryElement>('[pathLength]')];
  const texts = [...g.querySelectorAll('text')];

  if (profile.reducedMotion) return;

  // the white plate opens out to full bleed as it arrives
  gsap.fromTo(
    plate,
    { '--inset-x': () => `${Math.min(innerWidth * 0.08, 120)}px` },
    { '--inset-x': '0px', ease: 'none', scrollTrigger: { trigger: section, start: 'top bottom', end: 'top 15%', scrub: true } },
  );

  // the drawing draws itself while the essay is read
  strokes.forEach((s) => {
    s.style.strokeDasharray = s.classList.contains('d-dash') ? '' : '1';
    s.style.strokeDashoffset = s.classList.contains('d-dash') ? '' : '1';
  });
  const solid = strokes.filter((s) => !s.classList.contains('d-dash'));
  const tl = gsap.timeline({
    scrollTrigger: { trigger: section.querySelector('.vision__grid'), start: 'top 75%', end: 'bottom 70%', scrub: 0.8 },
  });
  tl.from(strokes.filter((s) => s.classList.contains('d-dash')), { opacity: 0, duration: 0.1 }, 0);
  tl.to(solid, { strokeDashoffset: 0, duration: 0.5, stagger: 0.5 / solid.length, ease: 'none' }, 0);
  tl.from(texts, { opacity: 0, duration: 0.1, stagger: 0.05 }, 0.45);

  // facts count in the serif
  section.querySelectorAll<HTMLElement>('.vision__facts dd').forEach((dd) => {
    const end = Number(dd.textContent);
    const st = { v: end > 100 ? end - 40 : 0 };
    dd.textContent = String(Math.round(st.v));
    gsap.to(st, {
      v: end,
      duration: 2,
      ease: 'expo.out',
      onUpdate: () => (dd.textContent = String(Math.round(st.v))),
      scrollTrigger: { trigger: dd, start: 'top 90%', once: true },
    });
  });
}
