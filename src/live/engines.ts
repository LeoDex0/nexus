import { clamp, gaussian, rng } from '../util/math';

export type LogKind = 'info' | 'warn' | 'good';
export interface View {
  w: number;
  h: number;
  /** maps world (0..aspect, 0..1) to canvas pixels */
  pad: number;
  scale: number;
  ox: number;
  oy: number;
}

export interface Engine {
  readonly id: 'route' | 'balance' | 'place';
  readonly objectiveLabel: string;
  readonly p1: { label: string; min: number; max: number; value: number; fmt: (v: number) => string };
  readonly p2: { label: string; min: number; max: number; value: number; fmt: (v: number) => string };
  readonly description: string;
  readonly how: string;
  iterations: number;
  converged: boolean;
  /** baseline the improvement is measured against */
  baseline: number;
  objective(): number;
  format(v: number): string;
  /** lower objective is better for all engines */
  reset(seed: number, aspect: number): void;
  setAspect(aspect: number): void;
  setP1(v: number): void;
  setP2(v: number): void;
  /** run up to `budget` ms of real work; returns true when something changed */
  step(budget: number): boolean;
  draw(ctx: CanvasRenderingContext2D, v: View, t: number): void;
  pointerDown(x: number, y: number, v: View): boolean;
  pointerMove(x: number, y: number, v: View): void;
  pointerUp(): void;
  click(x: number, y: number, v: View): void;
  perturb(): void;
  onLog?: (text: string, kind?: LogKind) => void;
}

export const toPx = (v: View, x: number, y: number) => [v.ox + x * v.scale, v.oy + y * v.scale] as const;
export const toWorld = (v: View, px: number, py: number) => [(px - v.ox) / v.scale, (py - v.oy) / v.scale] as const;

/* ------------------------------------------------------------------------ */
/* ROUTE: travelling tour improved by 2-opt, with a storm that adds cost.   */
/* ------------------------------------------------------------------------ */

export class RouteEngine implements Engine {
  readonly id = 'route' as const;
  readonly objectiveLabel = 'Route length';
  readonly description = 'Freight routing. One vehicle must visit every depot. A 2-opt search keeps reversing segments of the route while that makes it shorter. Edges through the storm cost four times as much.';
  readonly how = 'Click to add a depot, click a depot to remove it, drag the storm';
  p1 = { label: 'Depots', min: 12, max: 200, value: 70, fmt: (v: number) => String(Math.round(v)) };
  p2 = { label: 'Storm radius', min: 0, max: 100, value: 45, fmt: (v: number) => `${Math.round(v * 3.4)} km` };
  iterations = 0;
  converged = false;
  baseline = 1;
  onLog?: (text: string, kind?: LogKind) => void;

  private aspect = 1.4;
  private xs: number[] = [];
  private ys: number[] = [];
  private tour: number[] = [];
  private i = 0;
  private j = 2;
  private sweepImproved = false;
  private storm = { x: 0.6, y: 0.45 };
  private dragStorm = false;
  private flash = new Map<number, number>();
  private visit = new Map<number, number>();
  private drive = 0;
  private lastDraw = 0;
  private time = 0;
  private r = rng(1);
  private moves = 0;

  private stormR() {
    return 0.05 + (this.p2.value / 100) * 0.22;
  }

  private cost(a: number, b: number) {
    const x1 = this.xs[a];
    const y1 = this.ys[a];
    const x2 = this.xs[b];
    const y2 = this.ys[b];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (this.p2.value <= 0) return len;
    // fraction of the segment inside the storm circle
    const R = this.stormR();
    const fx = x1 - this.storm.x;
    const fy = y1 - this.storm.y;
    const A = dx * dx + dy * dy;
    const B = 2 * (fx * dx + fy * dy);
    const C = fx * fx + fy * fy - R * R;
    const disc = B * B - 4 * A * C;
    if (disc <= 0 || A === 0) return len;
    const sq = Math.sqrt(disc);
    const t1 = (-B - sq) / (2 * A);
    const t2 = (-B + sq) / (2 * A);
    const inside = Math.max(0, Math.min(1, t2) - Math.max(0, t1));
    return len * (1 + inside * 3);
  }

  objective() {
    let s = 0;
    const n = this.tour.length;
    for (let k = 0; k < n; k++) s += this.cost(this.tour[k], this.tour[(k + 1) % n]);
    return s;
  }
  format(v: number) {
    return `${Math.round(v * 1000).toLocaleString('en-US')} km`;
  }

  reset(seed: number, aspect: number) {
    this.aspect = aspect;
    this.r = rng(seed);
    const n = Math.round(this.p1.value);
    this.xs = [];
    this.ys = [];
    // towns: a few clusters plus scattered depots
    const centres = Array.from({ length: 5 }, () => [0.12 + this.r() * (aspect - 0.24), 0.15 + this.r() * 0.7]);
    for (let k = 0; k < n; k++) this.addPoint(k % 3 === 0 ? undefined : centres[k % 5]);
    this.storm = { x: aspect * (0.35 + this.r() * 0.3), y: 0.3 + this.r() * 0.4 };
    // start from a random order: the search has to untangle it
    this.tour = Array.from({ length: n }, (_, k) => k);
    for (let k = n - 1; k > 0; k--) {
      const m = Math.floor(this.r() * (k + 1));
      [this.tour[k], this.tour[m]] = [this.tour[m], this.tour[k]];
    }
    this.i = 0;
    this.j = 2;
    this.iterations = 0;
    this.moves = 0;
    this.converged = false;
    this.sweepImproved = false;
    this.baseline = this.objective();
    this.flash.clear();
    this.onLog?.(`Random route through ${n} depots: ${this.format(this.baseline)}`);
  }

  private addPoint(centre?: number[]) {
    let x: number;
    let y: number;
    if (centre) {
      x = centre[0] + gaussian(this.r) * 0.07;
      y = centre[1] + gaussian(this.r) * 0.07;
    } else {
      x = 0.04 + this.r() * (this.aspect - 0.08);
      y = 0.06 + this.r() * 0.88;
    }
    this.xs.push(clamp(x, 0.03, this.aspect - 0.03));
    this.ys.push(clamp(y, 0.04, 0.96));
  }

  setAspect(a: number) {
    const k = a / this.aspect;
    this.xs = this.xs.map((x) => x * k);
    this.storm.x *= k;
    this.aspect = a;
    this.wake();
  }
  setP1(v: number) {
    const target = Math.round(v);
    const n = this.tour.length;
    if (target > n) {
      for (let k = n; k < target; k++) {
        this.addPoint();
        this.insertCheapest(this.xs.length - 1);
      }
    } else if (target < n) {
      // drop the newest points
      while (this.xs.length > target) {
        const idx = this.xs.length - 1;
        this.removePoint(idx);
      }
    }
    this.p1.value = target;
    this.wake();
  }
  setP2(v: number) {
    this.p2.value = v;
    this.wake();
  }
  private wake() {
    this.converged = false;
    this.sweepImproved = false;
    this.i = 0;
    this.j = 2;
  }

  private insertCheapest(p: number) {
    const n = this.tour.length;
    if (n < 2) {
      this.tour.push(p);
      return;
    }
    let best = 0;
    let bestD = Infinity;
    for (let k = 0; k < n; k++) {
      const a = this.tour[k];
      const b = this.tour[(k + 1) % n];
      const d = this.cost(a, p) + this.cost(p, b) - this.cost(a, b);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    this.tour.splice(best + 1, 0, p);
  }

  private removePoint(idx: number) {
    this.tour = this.tour.filter((k) => k !== idx).map((k) => (k > idx ? k - 1 : k));
    this.xs.splice(idx, 1);
    this.ys.splice(idx, 1);
  }

  step(budget: number) {
    if (this.converged) return false;
    const n = this.tour.length;
    if (n < 4) {
      this.converged = true;
      return false;
    }
    const t0 = performance.now();
    // visible pace: a few accepted moves per frame
    const maxMoves = n < 60 ? 1 : n < 120 ? 3 : 6;
    let moves = 0;
    let changed = false;
    while (performance.now() - t0 < budget && moves < maxMoves) {
      for (let c = 0; c < 400; c++) {
        const i = this.i;
        const j = this.j;
        this.iterations++;
        const a = this.tour[i];
        const b = this.tour[i + 1];
        const cc = this.tour[j];
        const d = this.tour[(j + 1) % n];
        if (!(i === 0 && j === n - 1)) {
          const delta = this.cost(a, cc) + this.cost(b, d) - this.cost(a, b) - this.cost(cc, d);
          if (delta < -1e-10) {
            // reverse tour[i+1..j]
            let lo = i + 1;
            let hi = j;
            while (lo < hi) {
              const tmp = this.tour[lo];
              this.tour[lo] = this.tour[hi];
              this.tour[hi] = tmp;
              lo++;
              hi--;
            }
            this.flash.set(a * 1000 + cc, this.time);
            this.flash.set(b * 1000 + d, this.time);
            this.sweepImproved = true;
            moves++;
            this.moves++;
            changed = true;
          }
        }
        // advance (i, j)
        this.j++;
        if (this.j >= n) {
          this.i++;
          this.j = this.i + 2;
          if (this.i >= n - 2) {
            this.i = 0;
            this.j = 2;
            if (!this.sweepImproved) {
              this.converged = true;
              this.onLog?.(`No improving 2-opt move left: ${this.format(this.objective())}`, 'good');
              return changed;
            }
            this.sweepImproved = false;
          }
        }
        if (moves >= maxMoves) break;
      }
    }
    if (moves && this.moves % 25 === 0) this.onLog?.(`${this.moves} segment reversals so far`);
    return changed;
  }

  draw(ctx: CanvasRenderingContext2D, v: View, t: number) {
    this.time = t;
    const n = this.tour.length;
    // storm
    if (this.p2.value > 0) {
      const [sx, sy] = toPx(v, this.storm.x, this.storm.y);
      const R = this.stormR() * v.scale;
      ctx.save();
      ctx.beginPath();
      ctx.arc(sx, sy, R, 0, Math.PI * 2);
      ctx.clip();
      ctx.strokeStyle = 'rgba(255,179,71,0.16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = -R * 2; k < R * 2; k += 9) {
        ctx.moveTo(sx + k - R, sy - R);
        ctx.lineTo(sx + k + R, sy + R);
      }
      ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = this.dragStorm ? 'rgba(255,179,71,1)' : 'rgba(255,179,71,0.75)';
      ctx.setLineDash([4, 5]);
      ctx.lineDashOffset = -t * 10;
      ctx.beginPath();
      ctx.arc(sx, sy, R, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,179,71,0.9)';
      ctx.font = '9.5px "Martian Mono Variable", monospace';
      ctx.fillText('STORM CELL · COST ×4', sx - R * 0.7, sy - R - 10);
    }

    // route
    ctx.lineWidth = 1.1;
    ctx.strokeStyle = 'rgba(226,236,244,0.62)';
    ctx.beginPath();
    for (let k = 0; k <= n; k++) {
      const p = this.tour[k % n];
      const [x, y] = toPx(v, this.xs[p], this.ys[p]);
      if (k) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.stroke();

    // freshly changed edges
    ctx.lineWidth = 2;
    for (let k = 0; k < n; k++) {
      const a = this.tour[k];
      const b = this.tour[(k + 1) % n];
      const f = this.flash.get(a * 1000 + b) ?? this.flash.get(b * 1000 + a);
      if (f === undefined) continue;
      const age = t - f;
      if (age > 0.6) continue;
      ctx.strokeStyle = `rgba(79,230,255,${0.7 * (1 - age / 0.6)})`;
      const [x1, y1] = toPx(v, this.xs[a], this.ys[a]);
      const [x2, y2] = toPx(v, this.xs[b], this.ys[b]);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    if (this.flash.size > 4000) this.flash.clear();

    // the pair of edges the 2-opt search is testing right now
    if (!this.converged && n > 3) {
      const i = Math.min(this.i, n - 2);
      const j = Math.min(this.j, n - 1);
      const a = this.tour[i];
      const b = this.tour[i + 1];
      const c = this.tour[j];
      const d = this.tour[(j + 1) % n];
      const P = (k: number) => toPx(v, this.xs[k], this.ys[k]);
      ctx.strokeStyle = 'rgba(79,230,255,0.9)';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(...P(a));
      ctx.lineTo(...P(b));
      ctx.moveTo(...P(c));
      ctx.lineTo(...P(d));
      ctx.stroke();
      ctx.setLineDash([3, 4]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(79,230,255,0.55)';
      ctx.beginPath();
      ctx.moveTo(...P(a));
      ctx.lineTo(...P(c));
      ctx.moveTo(...P(b));
      ctx.lineTo(...P(d));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // vehicles drive the current route; depots light up as they pass
    const legs: number[] = [];
    let total = 0;
    for (let k = 0; k < n; k++) {
      const a = this.tour[k];
      const b = this.tour[(k + 1) % n];
      const l = Math.hypot(this.xs[b] - this.xs[a], this.ys[b] - this.ys[a]);
      legs.push(l);
      total += l;
    }
    const vehicles = 3;
    const dtv = this.lastDraw ? Math.min(0.05, t - this.lastDraw) : 0;
    this.lastDraw = t;
    this.drive = (this.drive + dtv * 0.16) % 1;
    for (let q = 0; q < vehicles && total > 0; q++) {
      for (let trail = 0; trail < 6; trail++) {
        let dist = (((this.drive + q / vehicles - trail * 0.004) % 1) + 1) % 1 * total;
        let k = 0;
        while (k < n - 1 && dist > legs[k]) {
          dist -= legs[k];
          k++;
        }
        const a = this.tour[k];
        const b = this.tour[(k + 1) % n];
        const f = legs[k] > 0 ? dist / legs[k] : 0;
        const [x, y] = toPx(v, this.xs[a] + (this.xs[b] - this.xs[a]) * f, this.ys[a] + (this.ys[b] - this.ys[a]) * f);
        if (trail === 0) {
          this.visit.set(f < 0.5 ? a : b, t);
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(x - 3, y - 3, 6, 6);
        } else {
          ctx.fillStyle = `rgba(79,230,255,${0.5 - trail * 0.07})`;
          ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
        }
      }
    }

    // depots
    for (let p = 0; p < this.xs.length; p++) {
      const [x, y] = toPx(v, this.xs[p], this.ys[p]);
      if (p === 0) {
        ctx.fillStyle = '#4fe6ff';
        ctx.fillRect(x - 4, y - 4, 8, 8);
        ctx.strokeStyle = 'rgba(79,230,255,0.6)';
        ctx.strokeRect(x - 8.5, y - 8.5, 17, 17);
      } else {
        ctx.fillStyle = '#e8edf1';
        ctx.fillRect(x - 2, y - 2, 4, 4);
      }
      const seen = this.visit.get(p);
      if (seen !== undefined && t - seen < 0.8) {
        const k = (t - seen) / 0.8;
        ctx.strokeStyle = `rgba(79,230,255,${0.8 * (1 - k)})`;
        ctx.lineWidth = 1;
        ctx.strokeRect(x - 3 - k * 7, y - 3 - k * 7, 6 + k * 14, 6 + k * 14);
      }
    }
  }

  pointerDown(px: number, py: number, v: View) {
    const [x, y] = toWorld(v, px, py);
    if (this.p2.value > 0 && Math.hypot(x - this.storm.x, y - this.storm.y) < this.stormR()) {
      this.dragStorm = true;
      return true;
    }
    return false;
  }
  pointerMove(px: number, py: number, v: View) {
    if (!this.dragStorm) return;
    const [x, y] = toWorld(v, px, py);
    this.storm.x = clamp(x, 0, this.aspect);
    this.storm.y = clamp(y, 0, 1);
    this.wake();
  }
  pointerUp() {
    if (this.dragStorm) this.onLog?.('Storm cell moved, re-routing');
    this.dragStorm = false;
  }
  click(px: number, py: number, v: View) {
    const [x, y] = toWorld(v, px, py);
    // remove a depot if one is under the pointer
    for (let p = 1; p < this.xs.length; p++) {
      if (Math.hypot(this.xs[p] - x, this.ys[p] - y) * v.scale < 9 && this.xs.length > 5) {
        this.removePoint(p);
        this.p1.value = this.xs.length;
        this.wake();
        this.onLog?.(`Depot removed, ${this.xs.length} remain`);
        return;
      }
    }
    if (x < 0 || x > this.aspect || y < 0 || y > 1) return;
    this.xs.push(x);
    this.ys.push(y);
    this.insertCheapest(this.xs.length - 1);
    this.p1.value = this.xs.length;
    this.wake();
    this.onLog?.(`Depot added at cheapest insertion, ${this.xs.length} total`);
  }
  perturb() {
    this.storm = { x: this.aspect * (0.15 + this.r() * 0.7), y: 0.15 + this.r() * 0.7 };
    if (this.p2.value < 20) this.p2.value = 45;
    for (let k = 0; k < 6; k++) {
      this.addPoint();
      this.insertCheapest(this.xs.length - 1);
    }
    this.p1.value = this.xs.length;
    this.baseline = this.objective();
    this.wake();
    this.onLog?.(`Storm moved and 6 urgent depots added: ${this.format(this.baseline)}`, 'warn');
  }
}

export function segDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? clamp(((px - x1) * dx + (py - y1) * dy) / l2) : 0;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/* ------------------------------------------------------------------------ */
/* PLACE: k-means (Lloyd) moves edge sites toward their demand.             */
/* ------------------------------------------------------------------------ */

export class PlaceEngine implements Engine {
  readonly id = 'place' as const;
  readonly objectiveLabel = 'Mean latency';
  readonly description = 'Edge compute. Every demand point connects to its nearest site; each site then moves to the centre of the points it serves (Lloyd’s k-means). Latency falls until no site wants to move.';
  readonly how = 'Click to add a cluster of demand, perturb to move a population';
  p1 = { label: 'Demand points', min: 300, max: 4000, value: 1800, fmt: (v: number) => Math.round(v).toLocaleString('en-US') };
  p2 = { label: 'Sites', min: 2, max: 14, value: 7, fmt: (v: number) => String(Math.round(v)) };
  iterations = 0;
  converged = false;
  baseline = 1;
  onLog?: (text: string, kind?: LogKind) => void;

  private aspect = 1.4;
  private px = new Float32Array(0);
  private py = new Float32Array(0);
  private assign = new Int16Array(0);
  private sx: number[] = [];
  private sy: number[] = [];
  private dx: number[] = [];
  private dy: number[] = [];
  private r = rng(3);
  private lastStep = 0;
  private obj = 1;
  private centres: number[][] = [];

  objective() {
    return this.obj;
  }
  format(v: number) {
    return `${(2 + v * 42).toFixed(1)} ms`;
  }

  reset(seed: number, aspect: number) {
    this.aspect = aspect;
    this.r = rng(seed);
    this.centres = Array.from({ length: 7 }, () => [0.1 + this.r() * (aspect - 0.2), 0.12 + this.r() * 0.76, 0.03 + this.r() * 0.07]);
    this.genPoints(Math.round(this.p1.value));
    this.initSites(Math.round(this.p2.value));
    this.iterations = 0;
    this.converged = false;
    this.assignAll();
    this.baseline = this.obj;
    this.onLog?.(`${this.px.length.toLocaleString('en-US')} demand points, ${this.sx.length} sites placed at random`);
  }

  private genPoints(n: number) {
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (this.r() < 0.15) {
        this.px[i] = this.r() * this.aspect;
        this.py[i] = this.r();
      } else {
        const c = this.centres[Math.floor(this.r() * this.centres.length)];
        this.px[i] = clamp(c[0] + gaussian(this.r) * c[2], 0.01, this.aspect - 0.01);
        this.py[i] = clamp(c[1] + gaussian(this.r) * c[2], 0.01, 0.99);
      }
    }
    this.assign = new Int16Array(n);
  }

  private initSites(k: number) {
    this.sx = [];
    this.sy = [];
    for (let i = 0; i < k; i++) {
      this.sx.push(0.1 + this.r() * (this.aspect - 0.2));
      this.sy.push(0.1 + this.r() * 0.8);
    }
    this.dx = [...this.sx];
    this.dy = [...this.sy];
  }

  private assignAll() {
    const n = this.px.length;
    const k = this.sx.length;
    let total = 0;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bd = Infinity;
      for (let s = 0; s < k; s++) {
        const d = (this.px[i] - this.sx[s]) ** 2 + (this.py[i] - this.sy[s]) ** 2;
        if (d < bd) {
          bd = d;
          best = s;
        }
      }
      this.assign[i] = best;
      total += Math.sqrt(bd);
    }
    this.obj = total / n;
  }

  setAspect(a: number) {
    const k = a / this.aspect;
    for (let i = 0; i < this.px.length; i++) this.px[i] *= k;
    this.sx = this.sx.map((x) => x * k);
    this.dx = this.dx.map((x) => x * k);
    this.centres.forEach((c) => (c[0] *= k));
    this.aspect = a;
    this.converged = false;
  }
  setP1(v: number) {
    this.p1.value = Math.round(v);
    this.genPoints(this.p1.value);
    this.assignAll();
    this.converged = false;
  }
  setP2(v: number) {
    const k = Math.round(v);
    while (this.sx.length < k) {
      // new site at the point that is currently worst served
      let worst = 0;
      let wd = -1;
      for (let i = 0; i < this.px.length; i++) {
        const s = this.assign[i];
        const d = (this.px[i] - this.sx[s]) ** 2 + (this.py[i] - this.sy[s]) ** 2;
        if (d > wd) {
          wd = d;
          worst = i;
        }
      }
      this.sx.push(this.px[worst]);
      this.sy.push(this.py[worst]);
      this.dx.push(this.px[worst]);
      this.dy.push(this.py[worst]);
    }
    if (this.sx.length > k) {
      this.sx.length = k;
      this.sy.length = k;
      this.dx.length = k;
      this.dy.length = k;
    }
    this.p2.value = k;
    this.assignAll();
    this.converged = false;
  }

  step() {
    if (this.converged) return false;
    // one Lloyd iteration about every 120 ms so each move can be seen
    const now = performance.now();
    if (now - this.lastStep < 120) return false;
    this.lastStep = now;
    const k = this.sx.length;
    const sumX = new Float64Array(k);
    const sumY = new Float64Array(k);
    const cnt = new Int32Array(k);
    for (let i = 0; i < this.px.length; i++) {
      const s = this.assign[i];
      sumX[s] += this.px[i];
      sumY[s] += this.py[i];
      cnt[s]++;
    }
    let moved = 0;
    for (let s = 0; s < k; s++) {
      if (!cnt[s]) continue;
      const nx = sumX[s] / cnt[s];
      const ny = sumY[s] / cnt[s];
      moved = Math.max(moved, Math.hypot(nx - this.sx[s], ny - this.sy[s]));
      this.sx[s] = nx;
      this.sy[s] = ny;
    }
    const before = this.obj;
    this.assignAll();
    this.iterations++;
    if (moved < 2e-4) {
      this.converged = true;
      this.onLog?.(`Sites settled after ${this.iterations} iterations: ${this.format(this.obj)}`, 'good');
    } else if (before - this.obj > 0.0015 || this.iterations % 10 === 1) {
      this.onLog?.(`Iteration ${this.iterations}: ${this.format(before)} → ${this.format(this.obj)}, largest move ${(moved * 1000).toFixed(0)} km`);
    }
    return true;
  }

  draw(ctx: CanvasRenderingContext2D, v: View) {
    const k = this.sx.length;
    for (let s = 0; s < k; s++) {
      this.dx[s] += (this.sx[s] - this.dx[s]) * 0.18;
      this.dy[s] += (this.sy[s] - this.dy[s]) * 0.18;
    }
    // spokes from each point to its site
    ctx.strokeStyle = 'rgba(214,226,236,0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const n = this.px.length;
    const stride = n > 2500 ? 2 : 1;
    for (let i = 0; i < n; i += stride) {
      const s = this.assign[i];
      const [x, y] = toPx(v, this.px[i], this.py[i]);
      const [X, Y] = toPx(v, this.dx[s], this.dy[s]);
      ctx.moveTo(x, y);
      ctx.lineTo(X, Y);
    }
    ctx.stroke();
    // points, shaded by site
    for (let i = 0; i < n; i++) {
      const s = this.assign[i];
      const [x, y] = toPx(v, this.px[i], this.py[i]);
      const l = 150 + ((s * 37) % 90);
      ctx.fillStyle = `rgb(${l},${l + 6},${l + 12})`;
      ctx.fillRect(x - 0.75, y - 0.75, 1.5, 1.5);
    }
    // requests travelling from demand points to the site that serves them
    const nReq = Math.min(160, n);
    const tt = performance.now() / 1000;
    for (let q = 0; q < nReq; q++) {
      const i = Math.floor((q * 7919 + Math.floor(tt * 0.5 + q * 0.37) * 104729) % n);
      const s = this.assign[i];
      const f = (tt * 0.9 + q * 0.137) % 1;
      const [x, y] = toPx(v, this.px[i], this.py[i]);
      const [X, Y] = toPx(v, this.dx[s], this.dy[s]);
      ctx.fillStyle = `rgba(79,230,255,${0.25 + 0.6 * Math.sin(f * Math.PI)})`;
      ctx.fillRect(x + (X - x) * f - 1, y + (Y - y) * f - 1, 2, 2);
    }
    const load = new Array(k).fill(0);
    for (let i = 0; i < n; i++) load[this.assign[i]]++;

    // sites
    ctx.font = '9px "Martian Mono Variable", monospace';
    for (let s = 0; s < k; s++) {
      const [X, Y] = toPx(v, this.dx[s], this.dy[s]);
      // share of all demand this site serves
      ctx.strokeStyle = 'rgba(79,230,255,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(X, Y, 20, -Math.PI / 2, -Math.PI / 2 + (load[s] / n) * Math.PI * 2 * Math.min(4, k / 2));
      ctx.stroke();
      ctx.strokeStyle = 'rgba(214,226,236,0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(X, Y, 20, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#4fe6ff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(X, Y, 9, 0, Math.PI * 2);
      ctx.moveTo(X - 15, Y);
      ctx.lineTo(X - 4, Y);
      ctx.moveTo(X + 4, Y);
      ctx.lineTo(X + 15, Y);
      ctx.moveTo(X, Y - 15);
      ctx.lineTo(X, Y - 4);
      ctx.moveTo(X, Y + 4);
      ctx.lineTo(X, Y + 15);
      ctx.stroke();
      ctx.fillStyle = 'rgba(79,230,255,0.95)';
      ctx.fillText(`S${s + 1}`, X + 12, Y - 11);
    }
  }

  pointerDown() {
    return false;
  }
  pointerMove() {}
  pointerUp() {}

  click(px: number, py: number, v: View) {
    const [x, y] = toWorld(v, px, py);
    if (x < 0 || x > this.aspect || y < 0 || y > 1) return;
    const add = 220;
    const nx = new Float32Array(this.px.length + add);
    const ny = new Float32Array(this.py.length + add);
    nx.set(this.px);
    ny.set(this.py);
    for (let i = 0; i < add; i++) {
      nx[this.px.length + i] = clamp(x + gaussian(this.r) * 0.035, 0.01, this.aspect - 0.01);
      ny[this.py.length + i] = clamp(y + gaussian(this.r) * 0.035, 0.01, 0.99);
    }
    this.px = nx;
    this.py = ny;
    this.assign = new Int16Array(nx.length);
    this.assignAll();
    this.baseline = this.obj;
    this.p1.value = nx.length;
    this.converged = false;
    this.onLog?.(`Demand cluster of ${add} points added`, 'warn');
  }

  perturb() {
    const c = this.centres[Math.floor(this.r() * this.centres.length)];
    const ox = c[0];
    const oy = c[1];
    const nx2 = 0.1 + this.r() * (this.aspect - 0.2);
    const ny2 = 0.12 + this.r() * 0.76;
    let moved = 0;
    for (let i = 0; i < this.px.length; i++) {
      if (Math.hypot(this.px[i] - ox, this.py[i] - oy) < c[2] * 2.2) {
        this.px[i] = clamp(this.px[i] - ox + nx2, 0.01, this.aspect - 0.01);
        this.py[i] = clamp(this.py[i] - oy + ny2, 0.01, 0.99);
        moved++;
      }
    }
    c[0] = nx2;
    c[1] = ny2;
    this.assignAll();
    this.baseline = this.obj;
    this.converged = false;
    this.onLog?.(`Population shift: ${moved} demand points relocated`, 'warn');
  }
}
