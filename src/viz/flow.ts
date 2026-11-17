import { surface, type Surface } from '../util/canvas';
import { damp, rng, smoothstep, TAU } from '../util/math';

interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
  port: number;
  speed: number;
  hist: Float32Array;
  hi: number;
  acc: number;
  detour: number;
}

const PORTS = [
  { y: 0.24, name: 'NLRTM' },
  { y: 0.52, name: 'BEANR' },
  { y: 0.8, name: 'DEHAM' },
];
const LANES = [0.12, 0.27, 0.42, 0.58, 0.73, 0.88];
const HIST = 16;

/**
 * NEXUS Flow: freight streams entering on six corridors and curving into
 * three ports. The pointer is a corridor closure; streams slide around it.
 */
export function flowViz(canvas: HTMLCanvasElement, mobile: boolean, reduced: boolean) {
  const count = mobile ? 380 : 760;
  const r = rng(8);
  const ps: P[] = [];
  let cx = -999;
  let cy = -999;
  let px = -1;
  let py = -1;
  let closureR = 70;
  let pointerIn = false;

  const reset = (p: P, s: Surface, initial = false) => {
    const lane = Math.floor(r() * LANES.length);
    p.x = initial ? r() * s.w * 0.85 : -4 - r() * 30;
    p.y = s.h * (LANES[lane] + (r() - 0.5) * 0.045);
    p.port = Math.min(PORTS.length - 1, Math.floor((lane / LANES.length) * PORTS.length + (r() - 0.5) * 1.2));
    if (p.port < 0) p.port = 0;
    p.speed = 70 + r() * 55;
    p.vx = p.speed;
    p.vy = 0;
    p.hi = 0;
    p.acc = 0;
    p.detour = 0;
    for (let k = 0; k < HIST; k++) {
      p.hist[k * 2] = p.x;
      p.hist[k * 2 + 1] = p.y;
    }
  };

  const frame = (s: Surface, dt: number, t: number) => {
    const ctx = s.ctx;
    if (!ps.length) {
      for (let i = 0; i < count; i++) {
        const p = { hist: new Float32Array(HIST * 2) } as P;
        reset(p, s, true);
        ps.push(p);
      }
    }
    const tx = pointerIn ? px : s.w * (0.47 + 0.15 * Math.sin(t * 0.19));
    const ty = pointerIn ? py : s.h * (0.5 + 0.26 * Math.sin(t * 0.31 + 1));
    cx = cx < -900 ? tx : damp(cx, tx, 5, dt);
    cy = cy < -900 ? ty : damp(cy, ty, 5, dt);
    closureR = Math.max(42, Math.min(s.w, s.h) * 0.11);

    const k = reduced ? 0.35 : 1;
    const portX = s.w * 0.93;
    for (const p of ps) {
      const port = PORTS[p.port];
      const gx = portX - p.x;
      const gy = s.h * port.y - p.y;
      const gd = Math.hypot(gx, gy) + 1;
      // run along the corridor first, then bend into the port
      const bend = smoothstep(0.1, 0.85, p.x / portX);
      let dx = (1 - bend) + (gx / gd) * bend;
      let dy = (gy / gd) * bend;
      // closure: slide around the near side, push out if inside
      const ox = p.x - cx;
      const oy = p.y - cy;
      const od = Math.hypot(ox, oy) + 0.001;
      const infl = closureR * 2.2;
      if (od < infl) {
        const w = Math.pow(1 - od / infl, 1.5);
        const side = oy >= 0 ? 1 : -1;
        // tangent pointing forward and around
        const tnx = (-oy / od) * -side;
        const tny = (ox / od) * -side;
        dx = dx * (1 - w) + (tnx + (ox / od) * 0.6) * w * 1.4;
        dy = dy * (1 - w) + (tny + (oy / od) * 0.6) * w * 1.4;
        p.detour = Math.min(1, p.detour + dt * 4 * w);
      }
      p.detour = Math.max(0, p.detour - dt * 0.4);
      const dl = Math.hypot(dx, dy) + 1e-6;
      const blend = Math.min(1, dt * 3.2);
      p.vx += ((dx / dl) * p.speed - p.vx) * blend;
      p.vy += ((dy / dl) * p.speed - p.vy) * blend;
      p.x += p.vx * dt * k;
      p.y += p.vy * dt * k;
      p.acc += dt;
      if (p.acc > 0.035) {
        p.acc = 0;
        p.hi = (p.hi + 1) % HIST;
        p.hist[p.hi * 2] = p.x;
        p.hist[p.hi * 2 + 1] = p.y;
      }
      if (p.x > portX - 6 || p.y < -30 || p.y > s.h + 30) reset(p, s);
    }

    ctx.clearRect(0, 0, s.w, s.h);

    // map grid of dots
    ctx.fillStyle = 'rgba(214,226,236,0.1)';
    const step = 28;
    for (let y = step / 2; y < s.h; y += step) for (let x = step / 2; x < s.w; x += step) ctx.fillRect(x, y, 1, 1);
    // corridor entry ticks
    ctx.fillStyle = 'rgba(214,226,236,0.45)';
    for (const l of LANES) ctx.fillRect(0, s.h * l - 0.5, 10, 1);

    const drawSet = (cyan: boolean) => {
      ctx.beginPath();
      for (const p of ps) {
        if (cyan !== p.detour > 0.2) continue;
        const start = (p.hi + 1) % HIST;
        ctx.moveTo(p.hist[start * 2], p.hist[start * 2 + 1]);
        for (let q = 1; q < HIST; q++) {
          const i = (start + q) % HIST;
          ctx.lineTo(p.hist[i * 2], p.hist[i * 2 + 1]);
        }
        ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = cyan ? 'rgba(79,230,255,0.6)' : 'rgba(226,236,244,0.22)';
      ctx.lineWidth = 1;
      ctx.stroke();
    };
    drawSet(false);
    drawSet(true);

    // ports
    ctx.font = '9.5px "Martian Mono Variable", monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    for (const port of PORTS) {
      const y = s.h * port.y;
      ctx.fillStyle = '#e8edf1';
      ctx.fillRect(portX - 3, y - 3, 6, 6);
      ctx.strokeStyle = 'rgba(232,237,241,0.35)';
      ctx.strokeRect(portX - 8.5, y - 8.5, 17, 17);
      ctx.fillStyle = 'rgba(232,237,241,0.75)';
      ctx.fillText(port.name, portX - 16, y - 16);
    }
    ctx.textAlign = 'left';

    // closure
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = 'rgba(255,179,71,0.85)';
    ctx.setLineDash([4, 5]);
    ctx.lineDashOffset = -t * 12;
    ctx.beginPath();
    ctx.arc(0, 0, closureR, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(-6, -6);
    ctx.lineTo(6, 6);
    ctx.moveTo(6, -6);
    ctx.lineTo(-6, 6);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,179,71,0.9)';
    ctx.fillText('CORRIDOR CLOSED', closureR + 10, -closureR * 0.6);
    ctx.restore();
  };

  surface(canvas, frame);
  canvas.addEventListener('pointermove', (e) => {
    const rect = canvas.getBoundingClientRect();
    px = e.clientX - rect.left;
    py = e.clientY - rect.top;
    pointerIn = true;
  });
  canvas.addEventListener('pointerleave', () => (pointerIn = false));
}
