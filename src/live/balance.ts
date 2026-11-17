import { clamp, rng } from '../util/math';
import { segDist, toPx, type Engine, type LogKind, type View } from './engines';

/* ------------------------------------------------------------------------ */
/* BALANCE: DC power flow on a meshed grid, with sensitivity-based          */
/* redispatch. The reduced susceptance matrix is inverted once per topology; */
/* its columns give each plant's effect on every line (PTDF).                */
/* ------------------------------------------------------------------------ */

interface Bus {
  x: number;
  y: number;
  gen: boolean;
  cap: number;
  out: number;
  load: number;
  theta: number;
}
interface Line {
  a: number;
  b: number;
  x: number;
  cap: number;
  out: boolean;
  flow: number;
  shown: number;
}

const STEP_MS = 110;

export class BalanceEngine implements Engine {
  readonly id = 'balance' as const;
  readonly objectiveLabel = 'Peak line load';
  readonly description = 'Power grid. Flows come from a DC power-flow model of the network. When lines run over their limits, every plant is adjusted at once along the gradient of total overload, then the flows are solved again.';
  readonly how = 'Click a line to cut or restore it, perturb for a demand spike';
  p1 = { label: 'Buses', min: 16, max: 80, value: 40, fmt: (v: number) => String(Math.round(v)) };
  p2 = { label: 'Demand', min: 50, max: 140, value: 100, fmt: (v: number) => `${Math.round(v)}%` };
  iterations = 0;
  converged = false;
  baseline = 1;
  onLog?: (text: string, kind?: LogKind) => void;

  private aspect = 1.4;
  private buses: Bus[] = [];
  private lines: Line[] = [];
  private X: Float64Array = new Float64Array(0); // (n-1)^2, slack = bus 0
  private n = 0;
  private r = rng(2);
  private seed = 2;
  private spike = new Map<number, number>();
  /** fraction of demand shed at a bus, the last resort */
  private shed = new Map<number, number>();
  private lastStep = 0;
  private lastOut = new Map<number, number>();
  private pulseAt = new Map<number, number>();
  private shifts = 0;
  private bestPeak = Infinity;
  private stall = 0;

  objective() {
    let m = 0;
    for (const l of this.lines) if (!l.out) m = Math.max(m, Math.abs(l.flow) / l.cap);
    return m;
  }
  format(v: number) {
    return `${Math.round(v * 100)}%`;
  }

  reset(seed: number, aspect: number) {
    this.seed = seed;
    this.aspect = aspect;
    this.r = rng(seed);
    this.build();
  }

  private build() {
    const n = Math.round(this.p1.value);
    const r = this.r;
    const A = this.aspect;
    this.buses = [];
    let guard = 0;
    while (this.buses.length < n && guard++ < 20000) {
      const x = 0.05 + r() * (A - 0.1);
      const y = 0.07 + r() * 0.86;
      const minD = 0.62 / Math.sqrt(n);
      if (this.buses.every((b) => Math.hypot(b.x - x, b.y - y) > minD)) this.buses.push({ x, y, gen: false, cap: 0, out: 0, load: 0, theta: 0 });
    }
    const N = this.buses.length;
    this.n = N;
    const d = (i: number, j: number) => Math.hypot(this.buses[i].x - this.buses[j].x, this.buses[i].y - this.buses[j].y);
    // minimum spanning tree keeps it connected, nearest neighbours mesh it
    const inTree = new Array(N).fill(false);
    const best = new Array(N).fill(Infinity);
    const from = new Array(N).fill(-1);
    best[0] = 0;
    const keys = new Set<string>();
    this.lines = [];
    const addLine = (a: number, b: number) => {
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (keys.has(key) || a === b) return;
      keys.add(key);
      this.lines.push({ a, b, x: d(a, b) * (0.8 + r() * 0.4), cap: 1, out: false, flow: 0, shown: 0 });
    };
    for (let it = 0; it < N; it++) {
      let u = -1;
      for (let k = 0; k < N; k++) if (!inTree[k] && (u < 0 || best[k] < best[u])) u = k;
      inTree[u] = true;
      if (from[u] >= 0) addLine(u, from[u]);
      for (let k = 0; k < N; k++) {
        const dk = d(u, k);
        if (!inTree[k] && dk < best[k]) {
          best[k] = dk;
          from[k] = u;
        }
      }
    }
    for (let i = 0; i < N; i++) {
      const near = Array.from({ length: N }, (_, k) => k)
        .filter((k) => k !== i)
        .sort((p, q) => d(i, p) - d(i, q))
        .slice(0, 2);
      for (const k of near) if (r() < 0.6) addLine(i, k);
    }
    // plants: bus 0 is the slack plant, plus about a fifth of the rest
    const gens = Math.max(4, Math.round(N * 0.2));
    const order = Array.from({ length: N - 1 }, (_, k) => k + 1).sort(() => r() - 0.5);
    const genSet = new Set([0, ...order.slice(0, gens - 1)]);
    this.buses.forEach((b, i) => {
      b.gen = genSet.has(i);
      b.load = b.gen ? 0 : 0.4 + r() * 0.9;
    });
    const total = this.totalDemand();
    const gl = this.buses.filter((b) => b.gen);
    gl.forEach((b) => (b.cap = ((total * 2) / gl.length) * (0.6 + r() * 0.8)));
    this.factor();
    // line limits come from a hidden reference dispatch with headroom, so a
    // feasible answer always exists; the visible start is a naive dispatch
    const ref = gl.map(() => 0.2 + r());
    const refSum = ref.reduce((a, b) => a + b, 0);
    gl.forEach((b, i) => (b.out = Math.min(b.cap, (ref[i] / refSum) * total)));
    this.shed.clear();
    this.solve();
    for (const l of this.lines) l.cap = Math.max(0.3, Math.abs(l.flow) * (1.06 + r() * 0.5));
    const capSum = gl.reduce((s, b) => s + b.cap, 0);
    gl.forEach((b) => (b.out = (b.cap / capSum) * total));
    this.solve();
    for (const l of this.lines) l.shown = l.flow;
    this.spike.clear();
    this.iterations = 0;
    this.shifts = 0;
    this.restartSearch();
    this.baseline = this.objective();
    this.onLog?.(`Grid of ${N} buses, ${this.lines.length} lines, ${gl.length} plants. Peak load ${this.format(this.baseline)}`);
  }

  private demand(i: number) {
    return this.buses[i].load * (this.p2.value / 100) * (this.spike.get(i) ?? 1) * (1 - (this.shed.get(i) ?? 0));
  }
  private totalDemand() {
    let s = 0;
    for (let i = 0; i < this.buses.length; i++) s += this.demand(i);
    return s;
  }

  /** Builds and inverts the reduced susceptance matrix (Gauss-Jordan). */
  private factor() {
    const m = this.n - 1;
    const B = new Float64Array(m * m);
    for (const l of this.lines) {
      if (l.out) continue;
      const y = 1 / l.x;
      const a = l.a - 1;
      const b = l.b - 1;
      if (a >= 0) B[a * m + a] += y;
      if (b >= 0) B[b * m + b] += y;
      if (a >= 0 && b >= 0) {
        B[a * m + b] -= y;
        B[b * m + a] -= y;
      }
    }
    const inv = new Float64Array(m * m);
    for (let i = 0; i < m; i++) inv[i * m + i] = 1;
    for (let c = 0; c < m; c++) {
      let piv = c;
      for (let rI = c + 1; rI < m; rI++) if (Math.abs(B[rI * m + c]) > Math.abs(B[piv * m + c])) piv = rI;
      if (piv !== c) {
        for (let k = 0; k < m; k++) {
          [B[c * m + k], B[piv * m + k]] = [B[piv * m + k], B[c * m + k]];
          [inv[c * m + k], inv[piv * m + k]] = [inv[piv * m + k], inv[c * m + k]];
        }
      }
      const p = B[c * m + c] || 1e-12;
      for (let k = 0; k < m; k++) {
        B[c * m + k] /= p;
        inv[c * m + k] /= p;
      }
      for (let rI = 0; rI < m; rI++) {
        if (rI === c) continue;
        const f = B[rI * m + c];
        if (f === 0) continue;
        for (let k = 0; k < m; k++) {
          B[rI * m + k] -= f * B[c * m + k];
          inv[rI * m + k] -= f * inv[c * m + k];
        }
      }
    }
    this.X = inv;
  }

  private x(i: number, k: number) {
    if (i === 0 || k === 0) return 0;
    const m = this.n - 1;
    return this.X[(i - 1) * m + (k - 1)];
  }

  /** Slack plant takes the imbalance, then angles and flows from θ = X·P. */
  private solve() {
    const N = this.n;
    let other = 0;
    for (let i = 1; i < N; i++) if (this.buses[i].gen) other += this.buses[i].out;
    this.buses[0].out = this.totalDemand() - other;
    const P = new Float64Array(N);
    for (let i = 0; i < N; i++) P[i] = (this.buses[i].gen ? this.buses[i].out : 0) - this.demand(i);
    const m = N - 1;
    for (let i = 1; i < N; i++) {
      let s = 0;
      const row = (i - 1) * m;
      for (let k = 1; k < N; k++) s += this.X[row + k - 1] * P[k];
      this.buses[i].theta = s;
    }
    this.buses[0].theta = 0;
    for (const l of this.lines) l.flow = l.out ? 0 : (this.buses[l.a].theta - this.buses[l.b].theta) / l.x;
    this.iterations++;
  }

  /** Change in line flow per unit injected at bus k (withdrawn at the slack). */
  private sens(l: Line, k: number) {
    return (this.x(l.a, k) - this.x(l.b, k)) / l.x;
  }

  setAspect(a: number) {
    const k = a / this.aspect;
    this.buses.forEach((b) => (b.x *= k));
    this.aspect = a;
  }
  setP1(v: number) {
    this.p1.value = Math.round(v);
    this.r = rng(this.seed);
    this.build();
  }
  setP2(v: number) {
    this.p2.value = v;
    this.shed.clear();
    this.solve();
    this.restartSearch();
  }

  private restartSearch() {
    this.converged = false;
    this.bestPeak = Infinity;
    this.stall = 0;
  }

  /** Sum of squared overloads; the quantity the redispatch minimises. */
  private penalty() {
    let p = 0;
    for (const l of this.lines) {
      if (l.out) continue;
      const o = Math.abs(l.flow) - l.cap * 0.98;
      if (o > 0) p += o * o;
    }
    return p;
  }

  /**
   * One visible step of projected gradient descent on the overload penalty.
   * Every plant moves at once, so fixing one line cannot just push the
   * problem onto its neighbour. If no plant move helps, load is shed at the
   * bus that relieves the worst line most per megawatt.
   */
  step() {
    if (this.converged) return false;
    const now = performance.now();
    if (now - this.lastStep < STEP_MS) return false;
    this.lastStep = now;

    const peakBefore = this.objective();
    // progress check: a long tail of tiny gains counts as a stall
    if (peakBefore < this.bestPeak - 0.002) {
      this.bestPeak = peakBefore;
      this.stall = 0;
    } else this.stall++;
    const stalled = this.stall > 12;
    if (stalled) this.stall = 0;
    for (let inner = 0; inner < 3; inner++) {
      if (this.objective() <= 1.0) break;
      if (stalled || !this.gradientStep()) {
        if (!this.shedLoad()) {
          this.converged = true;
          this.onLog?.(`Nothing left to adjust: peak ${this.format(this.objective())}`, 'warn');
          return true;
        }
        break;
      }
    }
    this.shifts++;
    const peak = this.objective();
    if (peak <= 1.0) {
      this.converged = true;
      let shedMW = 0;
      for (const [k, f] of this.shed) shedMW += this.buses[k].load * (this.p2.value / 100) * (this.spike.get(k) ?? 1) * f;
      const tail = shedMW > 0 ? `, ${Math.round(shedMW * 100)} MW shed` : '';
      this.onLog?.(`All lines within limits after ${this.shifts} steps. Peak ${this.format(peak)}${tail}`, 'good');
      return true;
    }
    if (this.shifts % 3 === 1) this.onLog?.(`Step ${this.shifts}: peak ${this.format(peakBefore)} → ${this.format(peak)}`, 'warn');
    return true;
  }

  private gradientStep() {
    const before = this.penalty();
    const gens = this.buses.map((b, k) => (b.gen && k !== 0 ? k : -1)).filter((k) => k >= 0);
    const grad = new Float64Array(this.n);
    for (const l of this.lines) {
      if (l.out) continue;
      const o = Math.abs(l.flow) - l.cap * 0.98;
      if (o <= 0) continue;
      const sg = 2 * o * Math.sign(l.flow);
      for (const k of gens) grad[k] += sg * this.sens(l, k);
    }
    // directions blocked by a plant limit do not count
    const free: number[] = [];
    for (const k of gens) {
      const b = this.buses[k];
      if ((b.out <= 1e-6 && grad[k] > 0) || (b.out >= b.cap - 1e-6 && grad[k] < 0)) grad[k] = 0;
      else free.push(k);
    }
    // the slack plant balances every move; if it sits on a limit, keep the
    // move's total at zero so it is not pushed past it
    const slackNow = this.buses[0];
    let sum = 0;
    for (const k of free) sum -= grad[k];
    const slackBlocked = (slackNow.out >= slackNow.cap - 1e-4 && sum < 0) || (slackNow.out <= 1e-4 && sum > 0);
    if (slackBlocked && free.length > 1) {
      const mean = sum / free.length;
      for (const k of free) grad[k] += mean;
    }
    let norm = 0;
    for (const k of gens) norm += grad[k] * grad[k];
    norm = Math.sqrt(norm);
    if (norm < 1e-9) return false;
    const saved = gens.map((k) => this.buses[k].out);
    const demand = this.totalDemand();
    const slack = this.buses[0];
    let alpha = Math.min(0.8, Math.max(0.06, 2 * Math.sqrt(before)));
    for (let tries = 0; tries < 14; tries++) {
      gens.forEach((k, i) => {
        const b = this.buses[k];
        b.out = clamp(saved[i] - (alpha * grad[k]) / norm, 0, b.cap);
      });
      let other = 0;
      for (const k of gens) other += this.buses[k].out;
      const slackOut = demand - other;
      if (slackOut >= 0 && slackOut <= slack.cap) {
        this.solve();
        if (this.penalty() < before * 0.9999) return true;
      }
      alpha *= 0.5;
    }
    gens.forEach((k, i) => (this.buses[k].out = saved[i]));
    this.solve();
    return false;
  }

  private shedLoad() {
    let worst: Line | null = null;
    let wl = 0.98;
    for (const l of this.lines) {
      if (l.out) continue;
      const load = Math.abs(l.flow) / l.cap;
      if (load > wl) {
        wl = load;
        worst = l;
      }
    }
    if (!worst) return false;
    const w = worst;
    const dir = Math.sign(w.flow);
    let bus = -1;
    let rel = 0;
    this.buses.forEach((b, k) => {
      if (b.gen || (this.shed.get(k) ?? 0) > 0.9) return;
      const s = this.sens(w, k) * dir; // shedding raises net injection here
      if (s < rel) {
        rel = s;
        bus = k;
      }
    });
    if (bus < 0) return false;
    const need = (Math.abs(w.flow) - w.cap * 0.97) / -rel;
    const cur = this.demand(bus);
    const frac = this.shed.get(bus) ?? 0;
    const base = cur / (1 - frac);
    const cut = Math.min(need, cur * 0.5);
    this.shed.set(bus, Math.min(0.95, frac + cut / base));
    this.solve();
    this.onLog?.(`Redispatch exhausted on line ${w.a}–${w.b}: ${Math.round(cut * 100)} MW of load shed at bus ${bus}`, 'warn');
    return true;
  }

  draw(ctx: CanvasRenderingContext2D, v: View, t: number) {
    for (const l of this.lines) {
      l.shown += (l.flow - l.shown) * 0.12;
      const [x1, y1] = toPx(v, this.buses[l.a].x, this.buses[l.a].y);
      const [x2, y2] = toPx(v, this.buses[l.b].x, this.buses[l.b].y);
      if (l.out) {
        ctx.strokeStyle = 'rgba(255,179,71,0.55)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 6]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.setLineDash([]);
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        ctx.beginPath();
        ctx.moveTo(mx - 4, my - 4);
        ctx.lineTo(mx + 4, my + 4);
        ctx.moveTo(mx + 4, my - 4);
        ctx.lineTo(mx - 4, my + 4);
        ctx.stroke();
        continue;
      }
      const load = Math.abs(l.shown) / l.cap;
      const col = load > 1.005 ? '255,179,71' : load > 0.85 ? '79,230,255' : '226,236,244';
      ctx.strokeStyle = `rgba(${col},${load > 0.85 ? 0.9 : 0.14 + load * 0.3})`;
      ctx.lineWidth = 0.8 + Math.min(load, 1.6) * 1.5;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      // power packets: count and speed follow the flow, direction follows its sign
      const len = Math.hypot(x2 - x1, y2 - y1);
      const packets = Math.max(1, Math.round(len / 34));
      const speed = clamp(Math.abs(l.shown) * 0.35, 0.04, 0.8) * Math.sign(l.shown || 1);
      ctx.fillStyle = `rgba(${col},0.95)`;
      for (let q = 0; q < packets; q++) {
        const f = (((t * speed + q / packets) % 1) + 1) % 1;
        const px = x1 + (x2 - x1) * f;
        const py = y1 + (y2 - y1) * f;
        const sz = load > 0.85 ? 3 : 2;
        ctx.fillRect(px - sz / 2, py - sz / 2, sz, sz);
      }
      if (load > 1.005) {
        ctx.fillStyle = 'rgba(255,179,71,0.95)';
        ctx.font = '9px "Martian Mono Variable", monospace';
        ctx.fillText(`${Math.round(load * 100)}%`, (x1 + x2) / 2 + 6, (y1 + y2) / 2 - 6);
      }
    }
    ctx.font = '9px "Martian Mono Variable", monospace';
    this.buses.forEach((b, i) => {
      const [x, y] = toPx(v, b.x, b.y);
      if (b.gen) {
        const s = 13;
        ctx.fillStyle = '#060708';
        ctx.fillRect(x - s / 2, y - s / 2, s, s);
        ctx.strokeStyle = i === 0 ? '#4fe6ff' : '#e8edf1';
        ctx.lineWidth = 1;
        ctx.strokeRect(x - s / 2 + 0.5, y - s / 2 + 0.5, s - 1, s - 1);
        const f = b.cap > 0 ? clamp(b.out / b.cap) : 0;
        const prev = this.lastOut.get(i) ?? b.out;
        if (Math.abs(prev - b.out) > 0.002) this.pulseAt.set(i, t);
        this.lastOut.set(i, b.out);
        const pt = this.pulseAt.get(i);
        if (pt !== undefined && t - pt < 0.9) {
          const k = (t - pt) / 0.9;
          ctx.strokeStyle = `rgba(79,230,255,${0.9 * (1 - k)})`;
          ctx.strokeRect(x - s / 2 - k * 10, y - s / 2 - k * 10, s + k * 20, s + k * 20);
        }
        ctx.fillStyle = '#4fe6ff';
        ctx.fillRect(x - s / 2 + 2, y + s / 2 - 2 - (s - 4) * f, s - 4, (s - 4) * f);
        ctx.fillStyle = 'rgba(232,237,241,0.6)';
        ctx.fillText(i === 0 ? 'G0 SLACK' : `G${i}`, x + 10, y - 8);
      } else {
        const rad = 1.5 + this.demand(i) * 2.2;
        ctx.fillStyle = this.spike.has(i) ? '#ffb347' : 'rgba(232,237,241,0.85)';
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, Math.PI * 2);
        ctx.fill();
        if (this.shed.has(i)) {
          ctx.strokeStyle = 'rgba(255,179,71,0.9)';
          ctx.setLineDash([2, 3]);
          ctx.beginPath();
          ctx.arc(x, y, rad + 5, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    });
  }

  pointerDown() {
    return false;
  }
  pointerMove() {}
  pointerUp() {}

  click(px: number, py: number, v: View) {
    let best = -1;
    let bd = 10;
    this.lines.forEach((l, k) => {
      const [x1, y1] = toPx(v, this.buses[l.a].x, this.buses[l.a].y);
      const [x2, y2] = toPx(v, this.buses[l.b].x, this.buses[l.b].y);
      const dd = segDist(px, py, x1, y1, x2, y2);
      if (dd < bd) {
        bd = dd;
        best = k;
      }
    });
    if (best < 0) return;
    const l = this.lines[best];
    if (!l.out) {
      l.out = true;
      if (!this.connected()) {
        l.out = false;
        this.onLog?.(`Line ${l.a}–${l.b} kept: cutting it would island part of the grid`, 'warn');
        return;
      }
      this.onLog?.(`Line ${l.a}–${l.b} cut, power re-routes`, 'warn');
    } else {
      l.out = false;
      this.onLog?.(`Line ${l.a}–${l.b} restored`);
    }
    this.factor();
    this.shed.clear();
    this.solve();
    this.baseline = Math.max(this.objective(), 1e-6);
    this.restartSearch();
  }

  private connected() {
    const seen = new Array(this.n).fill(false);
    const stack = [0];
    seen[0] = true;
    let count = 1;
    while (stack.length) {
      const i = stack.pop()!;
      for (const l of this.lines) {
        if (l.out) continue;
        const j = l.a === i ? l.b : l.b === i ? l.a : -1;
        if (j >= 0 && !seen[j]) {
          seen[j] = true;
          count++;
          stack.push(j);
        }
      }
    }
    return count === this.n;
  }

  perturb() {
    const loads = this.buses.map((b, i) => ({ b, i })).filter((o) => !o.b.gen);
    const c = loads[Math.floor(this.r() * loads.length)];
    const near = loads.sort((p, q) => Math.hypot(p.b.x - c.b.x, p.b.y - c.b.y) - Math.hypot(q.b.x - c.b.x, q.b.y - c.b.y)).slice(0, 4);
    const pct = 25 + Math.round(this.r() * 25);
    for (const o of near) this.spike.set(o.i, 1 + pct / 100);
    this.shed.clear();
    this.solve();
    this.baseline = this.objective();
    this.restartSearch();
    this.onLog?.(`Demand spike +${pct}% at buses ${near.map((o) => o.i).join(', ')}`, 'warn');
  }
}
