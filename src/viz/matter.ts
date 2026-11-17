import { surface, type Surface } from '../util/canvas';
import { clamp, damp, easeInOut, rng } from '../util/math';

export interface Atom {
  x: number;
  y: number;
  z: number;
  sp: number; // species 0..2
}
export interface Structure {
  name: string;
  atoms: Atom[];
  bonds: [number, number][];
}

export const N = 64;

function build(name: string, raw: Atom[], bondLen: number): Structure {
  // centre, normalise and pad to N atoms so structures can morph
  const atoms = raw.slice(0, N);
  while (atoms.length < N) atoms.push({ ...atoms[atoms.length % raw.length] });
  let mx = 0;
  let my = 0;
  let mz = 0;
  for (const a of atoms) {
    mx += a.x;
    my += a.y;
    mz += a.z;
  }
  mx /= N;
  my /= N;
  mz /= N;
  let maxR = 0;
  for (const a of atoms) {
    a.x -= mx;
    a.y -= my;
    a.z -= mz;
    maxR = Math.max(maxR, Math.hypot(a.x, a.y, a.z));
  }
  for (const a of atoms) {
    a.x /= maxR;
    a.y /= maxR;
    a.z /= maxR;
  }
  // sort for coherent morphing
  atoms.sort((a, b) => a.y - b.y || a.x - b.x || a.z - b.z);
  const bonds: [number, number][] = [];
  const bl = bondLen / maxR;
  for (let i = 0; i < N; i++)
    for (let j = i + 1; j < N; j++) {
      const d = Math.hypot(atoms[i].x - atoms[j].x, atoms[i].y - atoms[j].y, atoms[i].z - atoms[j].z);
      if (d > 0.001 && d < bl * 1.08) bonds.push([i, j]);
    }
  return { name, atoms, bonds };
}

function perovskite() {
  const a: Atom[] = [];
  for (let x = 0; x < 3; x++)
    for (let y = 0; y < 3; y++)
      for (let z = 0; z < 3; z++) {
        a.push({ x, y, z, sp: 0 });
        if (x < 2 && y < 2 && z < 2) a.push({ x: x + 0.5, y: y + 0.5, z: z + 0.5, sp: 1 });
      }
  for (let x = 0; x < 2; x++) for (let z = 0; z < 2; z++) a.push({ x: x + 0.5, y: 1, z: z + 0.5, sp: 2 });
  return build('Perovskite oxide', a, 0.88);
}
function layered() {
  const a: Atom[] = [];
  for (let layer = 0; layer < 4; layer++)
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) {
        const x = i + (j % 2) * 0.5;
        const z = j * 0.866;
        a.push({ x, y: layer * 1.25, z, sp: layer % 2 ? 1 : 0 });
      }
  return build('Layered cathode', a, 1.0);
}
function diamond() {
  const a: Atom[] = [];
  const basis = [
    [0, 0, 0],
    [0, 0.5, 0.5],
    [0.5, 0, 0.5],
    [0.5, 0.5, 0],
  ];
  for (let x = 0; x < 2; x++)
    for (let y = 0; y < 2; y++)
      for (let z = 0; z < 2; z++)
        for (const b of basis) {
          a.push({ x: x + b[0], y: y + b[1], z: z + b[2], sp: 0 });
          a.push({ x: x + b[0] + 0.25, y: y + b[1] + 0.25, z: z + b[2] + 0.25, sp: 2 });
        }
  return build('Covalent framework', a, 0.45);
}
function chains() {
  const a: Atom[] = [];
  for (let c = 0; c < 4; c++)
    for (let k = 0; k < 4; k++)
      for (let i = 0; i < 4; i++) {
        a.push({ x: i * 0.9, y: c * 1.1 + (i % 2) * 0.45, z: k * 1.1, sp: i % 2 ? 1 : 0 });
      }
  return build('Olivine phosphate', a, 1.02);
}

const CLASSES = [perovskite, layered, diamond, chains];
export const buildStructures = () => CLASSES.map((f) => f());

/** NEXUS Matter: a crystal specimen that morphs through candidate structures. */
export function matterViz(canvas: HTMLCanvasElement, table: HTMLElement | null, reduced: boolean) {
  const structs = CLASSES.map((f) => f());
  let cur = 0;
  let next = 1;
  let morph = 0;
  let hold = 0;
  let yaw = 0.6;
  let pitch = -0.38;
  let yawVel = 0;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  const r = rng(77);
  const pos = structs[0].atoms.map((a) => ({ ...a }));
  const proj = pos.map(() => ({ x: 0, y: 0, z: 0, s: 1 }));
  const order = pos.map((_, i) => i);
  let runId = 4700;

  const addRow = (name: string) => {
    if (!table) return;
    runId += 7 + Math.floor(r() * 90);
    const stab = 0.86 + r() * 0.135;
    const status = stab > 0.965 ? 'Queued for synthesis' : stab > 0.93 ? 'Promising' : 'Screened';
    const tr = document.createElement('tr');
    tr.className = 'is-new';
    tr.innerHTML = `<td>NX-${runId}</td><td>${name}</td><td${stab > 0.93 ? ' class="is-good"' : ''}>${stab.toFixed(3)}</td><td>${status}</td>`;
    table.prepend(tr);
    while (table.children.length > 5) table.lastElementChild!.remove();
  };
  // the first rows ship in the markup so the page height never jumps
  if (table && !table.children.length) {
    for (let i = 0; i < 4; i++) addRow(structs[(i + 2) % 4].name);
    table.querySelectorAll('tr').forEach((tr) => tr.classList.remove('is-new'));
  }

  const frame = (s: Surface, dt: number) => {
    const ctx = s.ctx;
    // timeline: hold a structure, then morph to the next one
    if (morph === 0) {
      hold += dt;
      if (hold > (reduced ? 6 : 3.2)) {
        hold = 0;
        morph = 0.0001;
      }
    } else {
      morph += dt / 1.6;
      if (morph >= 1) {
        morph = 0;
        cur = next;
        next = (next + 1) % structs.length;
        addRow(structs[cur].name);
      }
    }
    const k = easeInOut(clamp(morph));
    const A = structs[cur].atoms;
    const B = structs[next].atoms;
    for (let i = 0; i < N; i++) {
      pos[i].x = A[i].x + (B[i].x - A[i].x) * k;
      pos[i].y = A[i].y + (B[i].y - A[i].y) * k;
      pos[i].z = A[i].z + (B[i].z - A[i].z) * k;
      pos[i].sp = k < 0.5 ? A[i].sp : B[i].sp;
    }

    if (!dragging) {
      yawVel = damp(yawVel, reduced ? 0.05 : 0.28, 1.5, dt);
      yaw += yawVel * dt;
    }

    const R = Math.min(s.w, s.h) * 0.36;
    const cx = s.w / 2;
    const cy = s.h / 2;
    const cyw = Math.cos(yaw);
    const syw = Math.sin(yaw);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    for (let i = 0; i < N; i++) {
      const p = pos[i];
      const x1 = p.x * cyw + p.z * syw;
      const z1 = -p.x * syw + p.z * cyw;
      const y2 = p.y * cp - z1 * sp;
      const z2 = p.y * sp + z1 * cp;
      const f = 3.4 / (3.4 + z2);
      proj[i].x = cx + x1 * R * f;
      proj[i].y = cy + y2 * R * f;
      proj[i].z = z2;
      proj[i].s = f;
    }

    ctx.clearRect(0, 0, s.w, s.h);

    // bonds: old fade out, new fade in
    const drawBonds = (bonds: [number, number][], alpha: number) => {
      if (alpha <= 0.01) return;
      for (const [i, j] of bonds) {
        const za = (proj[i].z + proj[j].z) / 2;
        const a = alpha * (0.5 - za * 0.3);
        ctx.strokeStyle = `rgba(214,226,236,${clamp(a, 0.04, 0.8)})`;
        ctx.beginPath();
        ctx.moveTo(proj[i].x, proj[i].y);
        ctx.lineTo(proj[j].x, proj[j].y);
        ctx.stroke();
      }
    };
    ctx.lineWidth = 1;
    drawBonds(structs[cur].bonds, 1 - k);
    drawBonds(structs[next].bonds, k);

    order.sort((a, b) => proj[b].z - proj[a].z);
    for (const i of order) {
      const p = proj[i];
      const sp2 = pos[i].sp;
      const rad = (sp2 === 0 ? 7 : sp2 === 1 ? 5 : 3.6) * p.s * (R / 160);
      const depth = clamp(0.55 - p.z * 0.45, 0.15, 1);
      const g = ctx.createRadialGradient(p.x - rad * 0.35, p.y - rad * 0.4, rad * 0.1, p.x, p.y, rad);
      if (sp2 === 1) {
        g.addColorStop(0, `rgba(190,248,255,${depth})`);
        g.addColorStop(1, `rgba(20,120,140,${depth})`);
      } else if (sp2 === 2) {
        g.addColorStop(0, `rgba(255,255,255,${depth})`);
        g.addColorStop(1, `rgba(90,98,106,${depth})`);
      } else {
        g.addColorStop(0, `rgba(245,248,250,${depth})`);
        g.addColorStop(0.7, `rgba(120,128,136,${depth})`);
        g.addColorStop(1, `rgba(40,44,48,${depth})`);
      }
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
      ctx.fill();
    }

    // specimen label
    ctx.font = '9.5px "Martian Mono Variable", monospace';
    ctx.fillStyle = 'rgba(232,237,241,0.6)';
    ctx.textBaseline = 'top';
    ctx.fillText((morph > 0 ? 'Relaxing → ' + structs[next].name : structs[cur].name).toUpperCase(), 12, 12);
  };

  surface(canvas, frame);

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    yaw += dx * 0.01;
    yawVel = dx * 0.6;
    pitch = clamp(pitch + dy * 0.008, -1.2, 1.2);
  });
  const up = () => (dragging = false);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
}
