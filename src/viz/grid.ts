import { surface, type Surface } from '../util/canvas';
import { damp } from '../util/math';

/**
 * NEXUS Grid: an isometric field of load columns, one per network region.
 * Columns above the line limit turn cyan; hovering lets the system balance
 * the field, moving load from peaks into the valleys.
 */
export function gridViz(canvas: HTMLCanvasElement, caption: HTMLElement | null, reduced: boolean) {
  let balance = 0;
  let want = 0;
  let lastCap = 0;
  let hoverCell = -1;
  let mx = -1;
  let my = -1;
  const peaks = Array.from({ length: 5 }, (_, k) => ({
    fx: 0.08 + k * 0.025,
    fz: 0.06 + k * 0.03,
    px: k * 1.7,
    pz: k * 2.3,
    a: 0.5 + (k % 3) * 0.22,
    s: 0.13 + (k % 2) * 0.06,
  }));

  const frame = (s: Surface, dt: number, t: number) => {
    const ctx = s.ctx;
    const narrow = s.w < 620;
    const NX = narrow ? 14 : 20;
    const NZ = narrow ? 11 : 13;
    const tt = reduced ? t * 0.2 : t;
    balance = damp(balance, want, 1.4, dt);

    // load per cell
    const h: number[] = [];
    let sum = 0;
    for (let z = 0; z < NZ; z++)
      for (let x = 0; x < NX; x++) {
        const u = x / (NX - 1);
        const v = z / (NZ - 1);
        let val = 0.12 + 0.06 * Math.sin(u * 7 + tt * 0.5) * Math.cos(v * 5 - tt * 0.35);
        for (const p of peaks) {
          const cx = 0.5 + 0.36 * Math.sin(tt * p.fx + p.px);
          const cz = 0.5 + 0.36 * Math.cos(tt * p.fz + p.pz);
          val += p.a * Math.exp(-((u - cx) ** 2 + (v - cz) ** 2) / (p.s * p.s));
        }
        h.push(val);
        sum += val;
      }
    const mean = sum / h.length;
    let max = 0;
    for (let i = 0; i < h.length; i++) {
      h[i] = mean + (h[i] - mean) * (1 - 0.74 * balance);
      max = Math.max(max, h[i]);
    }

    ctx.clearRect(0, 0, s.w, s.h);
    // isometric cell size that fits the frame
    const cw = Math.min(s.w / (NX + NZ) * 0.98, (s.h * 0.62) / ((NX + NZ) * 0.5));
    const ch = cw * 0.5;
    const ox = s.w / 2 + ((NZ - NX) * cw) / 2;
    const oy = s.h * 0.34;
    const hs = s.h * 0.34;
    const limit = 0.72;
    const gap = cw * 0.12;
    const iso = (x: number, z: number, y: number) => [ox + (x - z) * cw, oy + (x + z) * ch - y * hs] as const;

    // ground plate outline
    ctx.strokeStyle = 'rgba(214,226,236,0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(...iso(0, 0, 0));
    ctx.lineTo(...iso(NX, 0, 0));
    ctx.lineTo(...iso(NX, NZ, 0));
    ctx.lineTo(...iso(0, NZ, 0));
    ctx.closePath();
    ctx.stroke();

    // hover: which cell is under the pointer (top faces, front to back)
    hoverCell = -1;

    // painter's order: back to front
    for (let d = 0; d < NX + NZ - 1; d++) {
      for (let x = 0; x < NX; x++) {
        const z = d - x;
        if (z < 0 || z >= NZ) continue;
        const i = z * NX + x;
        const val = h[i];
        const over = val > limit;
        const g0 = gap / cw;
        const x0 = x + g0;
        const x1 = x + 1 - g0;
        const z0 = z + g0;
        const z1 = z + 1 - g0;
        const top = [iso(x0, z0, val), iso(x1, z0, val), iso(x1, z1, val), iso(x0, z1, val)];
        // left face (along z), right face (along x)
        ctx.fillStyle = over ? 'rgb(14,52,60)' : 'rgb(20,23,27)';
        ctx.beginPath();
        ctx.moveTo(...iso(x0, z1, val));
        ctx.lineTo(...iso(x1, z1, val));
        ctx.lineTo(...iso(x1, z1, 0));
        ctx.lineTo(...iso(x0, z1, 0));
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = over ? 'rgb(22,78,90)' : 'rgb(30,34,39)';
        ctx.beginPath();
        ctx.moveTo(...iso(x1, z0, val));
        ctx.lineTo(...iso(x1, z1, val));
        ctx.lineTo(...iso(x1, z1, 0));
        ctx.lineTo(...iso(x1, z0, 0));
        ctx.closePath();
        ctx.fill();
        // top face
        const lit = 0.35 + Math.min(1, val) * 0.5;
        ctx.fillStyle = over ? `rgba(79,230,255,${0.55 + (val - limit)})` : `rgba(226,236,244,${lit * 0.55})`;
        ctx.beginPath();
        ctx.moveTo(...top[0]);
        for (let k = 1; k < 4; k++) ctx.lineTo(...top[k]);
        ctx.closePath();
        ctx.fill();
        if (mx >= 0 && inQuad(mx, my, top)) hoverCell = i;
        ctx.strokeStyle = over ? 'rgba(160,245,255,0.9)' : 'rgba(232,240,246,0.35)';
        ctx.stroke();
      }
    }

    // the line limit as a dashed plane outline
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = 'rgba(232,240,246,0.22)';
    ctx.beginPath();
    ctx.moveTo(...iso(0, 0, limit));
    ctx.lineTo(...iso(NX, 0, limit));
    ctx.lineTo(...iso(NX, NZ, limit));
    ctx.lineTo(...iso(0, NZ, limit));
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '9.5px "Martian Mono Variable", monospace';
    ctx.fillStyle = 'rgba(232,240,246,0.6)';
    const [lx, ly] = iso(NX, 0, limit);
    ctx.fillText('LINE LIMIT', lx + 8, ly);

    // readout for the cell under the pointer
    if (hoverCell >= 0) {
      const x = hoverCell % NX;
      const z = Math.floor(hoverCell / NX);
      const [tx, ty] = iso(x + 0.5, z + 0.5, h[hoverCell]);
      const pct = Math.round(52 + h[hoverCell] * 46);
      const label = `REGION ${String.fromCharCode(65 + z)}${x + 1} · ${pct}%`;
      ctx.fillStyle = 'rgba(6,7,8,0.9)';
      const w = ctx.measureText(label).width + 14;
      ctx.fillRect(tx + 10, ty - 26, w, 18);
      ctx.fillStyle = '#e8edf1';
      ctx.fillText(label, tx + 17, ty - 14);
    }

    if (caption && t - lastCap > 0.25) {
      lastCap = t;
      const pct = Math.round(52 + max * 46);
      caption.textContent = `${balance > 0.6 ? 'Balanced' : balance > 0.1 ? 'Balancing' : 'Unbalanced'} · peak ${pct}% of line limit`;
    }
  };

  surface(canvas, frame);
  const host = canvas.closest('figure') ?? canvas;
  host.addEventListener('pointerenter', (e) => {
    if ((e as PointerEvent).pointerType === 'mouse') want = 1;
  });
  host.addEventListener('pointerleave', (e) => {
    if ((e as PointerEvent).pointerType === 'mouse') want = 0;
    mx = -1;
  });
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    mx = e.clientX - r.left;
    my = e.clientY - r.top;
  });
  host.addEventListener('click', () => (want = want ? 0 : 1));
}

/** Point inside a convex quad given in drawing order. */
function inQuad(x: number, y: number, q: readonly (readonly [number, number])[]) {
  let sign = 0;
  for (let k = 0; k < 4; k++) {
    const [ax, ay] = q[k];
    const [bx, by] = q[(k + 1) % 4];
    const c = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (c !== 0) {
      if (sign === 0) sign = Math.sign(c);
      else if (Math.sign(c) !== sign) return false;
    }
  }
  return true;
}
