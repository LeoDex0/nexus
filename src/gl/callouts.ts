import * as THREE from 'three';
import type { Stage } from './stage';
import { clamp, damp } from '../util/math';

export interface CalloutDef {
  key: string;
  title: string;
  sub: string;
  side: 'l' | 'r';
}

interface Item extends CalloutDef {
  el: HTMLElement;
  line: SVGPolylineElement;
  dot: SVGCircleElement;
  ring: SVGCircleElement;
  shown: number;
  want: number;
  ax: number;
  ay: number;
  ly: number;
  emphasis: number;
}

const NS = 'http://www.w3.org/2000/svg';

/**
 * Technical leader-line callouts that follow points on the 3D structure.
 * Labels sit on fixed columns; only the leaders move with the object.
 */
export class Callouts {
  private items: Item[] = [];
  private p = { x: 0, y: 0 };
  private camRight = new THREE.Vector3();
  private w = new THREE.Vector3();
  /** for the architecture set: labels in one column right of the stack */
  column: 'split' | 'stack' = 'split';
  /** vertical band (fraction of the viewport) each side's labels may use */
  range: Record<'l' | 'r', [number, number]> = { l: [0.16, 0.86], r: [0.16, 0.86] };
  active = -1;

  constructor(
    private host: HTMLElement,
    svg: SVGSVGElement,
    defs: CalloutDef[],
    private stage: Stage,
  ) {
    for (const d of defs) {
      const el = document.createElement('div');
      el.className = `callout callout--${d.side}`;
      el.innerHTML = `<span class="callout__title">${d.title}</span><span class="callout__sub">${d.sub}</span>`;
      el.setAttribute('aria-hidden', 'true');
      host.appendChild(el);
      const line = document.createElementNS(NS, 'polyline');
      line.setAttribute('class', 'callout-line');
      line.setAttribute('pathLength', '1');
      const dot = document.createElementNS(NS, 'circle');
      dot.setAttribute('r', '2.5');
      dot.setAttribute('class', 'callout-dot');
      const ring = document.createElementNS(NS, 'circle');
      ring.setAttribute('r', '7');
      ring.setAttribute('class', 'callout-ring');
      svg.append(line, ring, dot);
      this.items.push({ ...d, el, line, dot, ring, shown: 0, want: 0, ax: 0, ay: 0, ly: 0, emphasis: 1 });
    }
  }

  /** Show the first `count` callouts (fractional counts are rounded down). */
  reveal(count: number) {
    this.items.forEach((it, i) => (it.want = i < count ? 1 : 0));
  }

  update(dt: number, visible: boolean) {
    const W = innerWidth;
    const H = innerHeight;
    const anchors = this.stage.structure.anchors;
    this.host.style.visibility = 'visible';
    let any = false;

    if (this.column === 'stack') {
      // right edge of each layer as seen from the camera
      this.camRight.setFromMatrixColumn(this.stage.camera.matrixWorld, 0).normalize();
    }

    for (const it of this.items) {
      it.shown = damp(it.shown, visible ? it.want : 0, 7, dt);
      const emph = this.column === 'stack' ? (this.active === this.items.indexOf(it) ? 1 : 0.35) : 1;
      it.emphasis = damp(it.emphasis, emph, 8, dt);
      if (it.shown > 0.005) any = true;
      const a = anchors[it.key];
      if (!a) continue;
      if (this.column === 'stack') {
        // anchors[layerN] holds the layer centre; push it to the visible edge
        const l = Number(it.key.slice(5));
        this.w.copy(a).addScaledVector(this.camRight, this.stage.structure.layerR[l] ?? 1);
        this.stage.project(this.w, this.p);
      } else {
        this.stage.project(a, this.p);
      }
      it.ax = this.p.x;
      it.ay = this.p.y;
      const [lo, hi] = this.range[it.side];
      it.ly = clamp(it.ay, H * lo, H * hi);
    }

    this.host.classList.toggle('is-off', !any);
    if (!any) return;

    // de-overlap labels per side
    const minGap = this.column === 'stack' ? 50 : 58;
    for (const side of ['l', 'r'] as const) {
      const list = this.items.filter((i) => i.side === side).sort((a, b) => a.ly - b.ly);
      for (let i = 1; i < list.length; i++) {
        if (list[i].ly - list[i - 1].ly < minGap) list[i].ly = list[i - 1].ly + minGap;
      }
      // if the stack ran past its band, slide it back up
      const hi = H * this.range[side][1];
      for (let i = list.length - 1; i >= 0; i--) {
        const limit = i === list.length - 1 ? hi : list[i + 1].ly - minGap;
        if (list[i].ly > limit) list[i].ly = limit;
      }
    }

    let stackX = 0;
    if (this.column === 'stack') {
      for (const it of this.items) stackX = Math.max(stackX, it.ax);
      stackX = Math.min(stackX + 70, W - 280);
    }

    for (const it of this.items) {
      const s = it.shown;
      let lx: number;
      if (this.column === 'stack') lx = stackX;
      else lx = it.side === 'l' ? Math.max(24, W * 0.2 - 40) : Math.min(W - 24, W * 0.8 + 40);
      const elbow = it.side === 'l' ? lx + 14 : lx - 14;
      const ex = it.ax + (elbow - it.ax) * 0.45;
      const pts = `${it.ax},${it.ay} ${ex},${it.ly} ${elbow},${it.ly}`;
      it.line.setAttribute('points', pts);
      it.line.style.strokeDashoffset = String(1 - s);
      it.line.style.opacity = String(Math.min(1, s * 2) * it.emphasis);
      it.dot.setAttribute('cx', String(it.ax));
      it.dot.setAttribute('cy', String(it.ay));
      it.ring.setAttribute('cx', String(it.ax));
      it.ring.setAttribute('cy', String(it.ay));
      it.dot.style.opacity = String(s * it.emphasis);
      it.ring.style.opacity = String(s * 0.6 * it.emphasis);
      it.el.style.transform = `translate3d(${lx}px, ${it.ly}px, 0)`;
      it.el.style.opacity = String(clamp((s - 0.4) / 0.6) * (0.25 + 0.75 * it.emphasis));
      it.el.style.setProperty('--reveal', String(clamp((s - 0.3) / 0.7)));
      it.el.classList.toggle('is-active', this.column === 'stack' && it.emphasis > 0.7);
    }
  }
}
