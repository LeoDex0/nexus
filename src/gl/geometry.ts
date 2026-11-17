import * as THREE from 'three';
import { rng, TAU } from '../util/math';

export interface RingProfile {
  rIn: number;
  rOut: number;
  /** height along the ring axis (local Y) */
  h: number;
  /** chamfer size on all four edges */
  c: number;
}

/** Chamfered rectangular cross-section, counter-clockwise in (r, y). */
export function chamferProfile({ rIn, rOut, h, c }: RingProfile): [number, number][] {
  const hh = h / 2;
  return [
    [rIn + c, -hh],
    [rOut - c, -hh],
    [rOut, -hh + c],
    [rOut, hh - c],
    [rOut - c, hh],
    [rIn + c, hh],
    [rIn, hh - c],
    [rIn, -hh + c],
  ];
}

/**
 * Revolves a closed counter-clockwise (r, y) profile around Y. Every
 * profile edge gets its own strip with its own normals, so chamfers and
 * grooves stay crisp and catch thin highlights like turned metal.
 * Tangents run around the circumference for circular brushing.
 * An open arc (thetaLength < 2π) gets flat end caps.
 */
export function revolve(prof: [number, number][], segments = 256, thetaStart = 0, thetaLength = TAU) {
  const edges = prof.length;
  const pos: number[] = [];
  const nor: number[] = [];
  const tan: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let total = 0;
  const lens = prof.map((p, k) => {
    const q = prof[(k + 1) % edges];
    const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
    total += l;
    return l;
  });
  let vi = 0;
  let acc = 0;
  for (let k = 0; k < edges; k++) {
    const [ar, ay] = prof[k];
    const [br, by] = prof[(k + 1) % edges];
    const l = Math.hypot(br - ar, by - ay);
    const nr = (by - ay) / l;
    const ny = -(br - ar) / l;
    const v0 = acc / total;
    const v1 = (acc + lens[k]) / total;
    acc += lens[k];
    const base = vi;
    for (let s = 0; s <= segments; s++) {
      const th = thetaStart + (s / segments) * thetaLength;
      const cs = Math.cos(th);
      const sn = Math.sin(th);
      pos.push(ar * cs, ay, ar * sn, br * cs, by, br * sn);
      nor.push(nr * cs, ny, nr * sn, nr * cs, ny, nr * sn);
      tan.push(-sn, 0, cs, 1, -sn, 0, cs, 1);
      uv.push(s / segments, v0, s / segments, v1);
      vi += 2;
    }
    for (let s = 0; s < segments; s++) {
      const a0 = base + s * 2;
      idx.push(a0, a0 + 1, a0 + 2, a0 + 1, a0 + 3, a0 + 2);
    }
  }
  if (thetaLength < TAU - 1e-6) {
    // end caps: fan over the (convex enough) profile
    for (const [th, sign] of [
      [thetaStart, -1],
      [thetaStart + thetaLength, 1],
    ] as const) {
      const cs = Math.cos(th);
      const sn = Math.sin(th);
      const nx = -sn * sign;
      const nz = cs * sign;
      const base = vi;
      for (const [r, y] of prof) {
        pos.push(r * cs, y, r * sn);
        nor.push(nx, 0, nz);
        tan.push(cs, 0, sn, 1);
        uv.push(0, 0);
        vi++;
      }
      for (let k = 1; k < edges - 1; k++) {
        if (sign > 0) idx.push(base, base + k, base + k + 1);
        else idx.push(base, base + k + 1, base + k);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('tangent', new THREE.Float32BufferAttribute(tan, 4));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** A machined ring: chamfered rectangular profile revolved around Y. */
export function machinedRing(p: RingProfile, segments = 256) {
  return revolve(chamferProfile(p), segments);
}

/** Fine streak noise along U: the roughness map for brushed aluminium. */
export function brushedTexture(seed = 7) {
  const w = 1024;
  const h = 64;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d')!;
  const r = rng(seed);
  ctx.fillStyle = 'rgb(120,120,120)';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 2600; i++) {
    const y = r() * h;
    const x = r() * w;
    const len = 40 + r() * 400;
    const v = 90 + r() * 90;
    ctx.strokeStyle = `rgba(${v},${v},${v},${0.25 + r() * 0.4})`;
    ctx.lineWidth = 0.5 + r();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 1);
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * Circuit pattern for the substrate plate: orthogonal and 45° traces,
 * pads and concentric guard rings, drawn white on black for use as an
 * emissive map (tinted cyan by the material).
 */
export function circuitTexture(seed = 3) {
  const S = 1024;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const ctx = cv.getContext('2d')!;
  const r = rng(seed);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, S, S);
  const c = S / 2;
  ctx.lineCap = 'square';

  // concentric guard rings
  for (const [rad, a] of [
    [0.47, 0.5],
    [0.44, 0.18],
    [0.2, 0.4],
    [0.12, 0.25],
  ]) {
    ctx.strokeStyle = `rgba(255,255,255,${a})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(c, c, rad * S, 0, TAU);
    ctx.stroke();
  }

  // traces: start near the inner ring, walk outward with 0/45/90° turns
  const dirs = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
  ];
  for (let i = 0; i < 150; i++) {
    const ang = r() * TAU;
    let x = c + Math.cos(ang) * S * 0.205;
    let y = c + Math.sin(ang) * S * 0.205;
    let d = Math.round(((ang / TAU) * 8 + 8) % 8) % 8;
    ctx.strokeStyle = `rgba(255,255,255,${0.25 + r() * 0.5})`;
    ctx.lineWidth = r() < 0.2 ? 3 : 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const steps = 3 + Math.floor(r() * 5);
    for (let s = 0; s < steps; s++) {
      const len = 12 + r() * 46;
      x += dirs[d][0] * len;
      y += dirs[d][1] * len;
      ctx.lineTo(x, y);
      if (r() < 0.6) d = (d + (r() < 0.5 ? 1 : 7)) % 8;
      if (Math.hypot(x - c, y - c) > S * 0.43) break;
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(x - 3, y - 3, 6, 6);
  }

  // radial tick ring on the rim
  for (let i = 0; i < 240; i++) {
    const a = (i / 240) * TAU;
    const long = i % 10 === 0;
    const r0 = S * (long ? 0.448 : 0.452);
    const r1 = S * 0.462;
    ctx.strokeStyle = `rgba(255,255,255,${long ? 0.8 : 0.35})`;
    ctx.lineWidth = long ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
    ctx.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Points evenly spread on a sphere. */
export function fibonacciSphere(n: number, radius: number) {
  const out: THREE.Vector3[] = [];
  const g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const rr = Math.sqrt(1 - y * y);
    const th = g * i;
    out.push(new THREE.Vector3(Math.cos(th) * rr * radius, y * radius, Math.sin(th) * rr * radius));
  }
  return out;
}
