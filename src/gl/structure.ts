import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { chamferProfile, circuitTexture, fibonacciSphere, machinedRing, revolve } from './geometry';
import type { MaterialSet } from './materials';
import { clamp, lerp, rng, smoothstep, TAU } from '../util/math';

type Kind = 'bezel' | 'segmented' | 'gear' | 'truss' | 'optical';

interface RingDef {
  key: string;
  name: string;
  spec: string;
  kind: Kind;
  rIn: number;
  rOut: number;
  h: number;
  c: number;
  axis: 'x' | 'z';
  packets: number;
  layer: number;
  stackY: number;
  // hero motion
  base: number;
  amp: number;
  freq: number;
  phase: number;
  omega: number;
  // fixed poses
  display: number;
  cta: number;
  /** offset along the ring's own normal in inspect mode */
  inspect: number;
}

const H = Math.PI / 2;
export const RING_DEFS: RingDef[] = [
  { key: 'energy', name: 'Context ring / energy', spec: 'Calibration bezel, brushed titanium, 180 marks', kind: 'bezel', rIn: 1.8, rOut: 2.03, h: 0.075, c: 0.012, axis: 'x', packets: 0, layer: 1, stackY: -1.32, base: 1.18, amp: 0.08, freq: 0.19, phase: 0, omega: 0, display: 1.32, cta: H, inspect: 0 },
  { key: 'time', name: 'Context ring / time', spec: '16 anodised segments, rolling 72-hour model', kind: 'segmented', rIn: 1.665, rOut: 1.725, h: 0.2, c: 0.01, axis: 'z', packets: 3, layer: 1, stackY: -0.92, base: 0.2, amp: 0.7, freq: 0.15, phase: 1, omega: 0.09, display: 0.62, cta: H, inspect: 0.5 },
  { key: 'space', name: 'Context ring / space', spec: 'Polished chrome gear, 120 teeth', kind: 'gear', rIn: 1.34, rOut: 1.54, h: 0.05, c: 0.01, axis: 'x', packets: 4, layer: 3, stackY: 0.72, base: 0.5, amp: 0.6, freq: 0.18, phase: 2, omega: -0.13, display: 1.05, cta: H, inspect: -0.42 },
  { key: 'risk', name: 'Context ring / risk', spec: 'Titanium truss, 48 struts', kind: 'truss', rIn: 1.115, rOut: 1.175, h: 0.16, c: 0.008, axis: 'z', packets: 3, layer: 3, stackY: 1.1, base: 0.8, amp: 0.5, freq: 0.24, phase: 3, omega: 0.19, display: 0.42, cta: H, inspect: 0.36 },
  { key: 'intent', name: 'Context ring / intent', spec: 'Six optical relays aimed at the lattice', kind: 'optical', rIn: 0.88, rOut: 1.0, h: 0.04, c: 0.008, axis: 'x', packets: 2, layer: 4, stackY: 1.55, base: 0.1, amp: 0.45, freq: 0.27, phase: 4, omega: -0.26, display: 1.25, cta: H, inspect: -0.3 },
];

export const PARTS = [...RING_DEFS.map((d) => ({ key: d.key, name: d.name, spec: d.spec })), { key: 'lattice', name: 'Photonic lattice', spec: '4,096 nodes in fused silica' }];

export const LAYER_Y = [-1.95, -1.12, -0.1, 0.91, 1.68];
export const LAYER_RADIUS = [2.3, 2.03, 0.7, 1.54, 1.0];

interface Ring {
  def: RingDef;
  group: THREE.Group;
  body: THREE.Mesh;
  mats: { m: THREE.MeshPhysicalMaterial; env: number }[];
  pins: THREE.Group | null;
  lights: THREE.Mesh[];
  beams: THREE.Mesh | null;
  packets: THREE.Points | null;
  angle: number;
  vel: number;
  spin: number;
  qGimbal: THREE.Quaternion;
  highlight: number;
  dim: number;
}

export interface StructureState {
  /** 0 = hero motion, 1 = display (core section) */
  display: number;
  /** 0..1 aligned cage for the final CTA */
  cta: number;
  /** 0..1 exploded architecture stack */
  explode: number;
  /** active architecture layer, fractional while moving */
  layer: number;
  /** hold-to-compute charge 0..1 */
  charge: number;
  /** overall brightness of the light elements */
  glow: number;
  /** 0..1 inspect mode: parts separate along their own axes */
  inspect: number;
  /** hovered part index (PARTS) or -1 */
  hover: number;
  /** idle calibration cycles are allowed */
  calibrate: boolean;
  /** quality: fewer details on small devices */
  lite: boolean;
}

/* ---------------------------------------------------------------------- */
/* shaders                                                                 */
/* ---------------------------------------------------------------------- */

const packetVert = /* glsl */ `
  attribute float aPhase;
  attribute float aSpeed;
  attribute float aTrail;
  uniform float uTime;
  uniform float uR;
  uniform float uY;
  uniform float uSize;
  uniform float uPR;
  uniform float uBoost;
  varying float vA;
  void main() {
    float dir = sign(aSpeed);
    float ang = aPhase + uTime * aSpeed * (1.0 + uBoost * 5.0) - aTrail * 0.018 * dir;
    vec3 p = vec3(cos(ang) * uR, uY, sin(ang) * uR);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float k = 1.0 - aTrail / 7.0;
    vA = k * k;
    gl_PointSize = uSize * uPR * (0.35 + 0.65 * k) * (7.0 / -mv.z);
  }`;

const packetFrag = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(uColor * (0.6 + a), a * vA * uOpacity);
  }`;

/** Light channel: a thin ring of light with a pulse that sweeps around it. */
const channelVert = /* glsl */ `
  varying float vAng;
  void main() {
    vAng = atan(position.z, position.x);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const channelFrag = /* glsl */ `
  uniform float uSweep;
  uniform float uAmp;
  uniform float uBase;
  uniform float uTime;
  uniform vec3 uColor;
  varying float vAng;
  void main() {
    float d = mod(vAng - uSweep + 3.14159265, 6.2831853) - 3.14159265;
    float head = exp(-pow(d * 6.0, 2.0)) + 0.5 * exp(-pow((d + 0.35) * 2.0, 2.0)) * step(d, 0.0);
    float tick = 0.5 + 0.5 * sin(vAng * 90.0 + uTime * 0.0);
    float b = uBase * (0.75 + 0.25 * tick) + uAmp * head * 2.6;
    gl_FragColor = vec4(uColor * b, 1.0);
  }`;

/** Beams from the optical relays to the lattice: pulses travel inward. */
const beamVert = /* glsl */ `
  varying float vT;
  void main() {
    vT = uv.y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const beamFrag = /* glsl */ `
  uniform float uTime;
  uniform float uOpacity;
  varying float vT;
  void main() {
    float pulse = pow(0.5 + 0.5 * sin(vT * 18.0 + uTime * 9.0), 8.0);
    float a = (0.18 + pulse * 0.8) * smoothstep(0.0, 0.15, vT) * smoothstep(1.0, 0.8, vT);
    gl_FragColor = vec4(vec3(0.45, 0.93, 1.0) * (0.7 + pulse), a * uOpacity);
  }`;

/** Packets travelling up and down the architecture spine. */
const spineVert = /* glsl */ `
  attribute float aAng;
  attribute float aPhase;
  attribute float aSpeed;
  uniform float uTime;
  uniform float uY0;
  uniform float uY1;
  uniform float uR;
  uniform float uPR;
  varying float vA;
  void main() {
    float f = fract(aPhase + uTime * aSpeed);
    float y = mix(uY0, uY1, aSpeed > 0.0 ? f : 1.0 - f);
    vec3 p = vec3(cos(aAng) * uR, y, sin(aAng) * uR);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    vA = smoothstep(0.0, 0.1, f) * smoothstep(1.0, 0.9, f);
    gl_PointSize = 5.0 * uPR * (8.0 / -mv.z);
  }`;
const spineFrag = /* glsl */ `
  uniform float uOpacity;
  varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vec3(0.5, 0.94, 1.0) * (0.6 + a), a * vA * uOpacity);
  }`;

/* ---------------------------------------------------------------------- */

const axisX = new THREE.Vector3(1, 0, 0);
const axisY = new THREE.Vector3(0, 1, 0);
const axisZ = new THREE.Vector3(0, 0, 1);

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[]) {
  const m = new THREE.InstancedMesh(geo, mat, mats.length);
  mats.forEach((x, i) => m.setMatrixAt(i, x));
  m.instanceMatrix.needsUpdate = true;
  m.computeBoundingSphere();
  return m;
}

/** Matrix for a radial element at angle a, radius r, height y, oriented along the radius. */
function radial(a: number, r: number, y: number, sx = 1, sy = 1, sz = 1) {
  const q = new THREE.Quaternion().setFromAxisAngle(axisY, -a);
  return new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r), q, new THREE.Vector3(sx, sy, sz));
}

/** Matrix for a cylinder (Y-up geometry) spanning from p to q. */
function span(p: THREE.Vector3, q: THREE.Vector3) {
  const dir = q.clone().sub(p);
  const len = dir.length();
  const quat = new THREE.Quaternion().setFromUnitVectors(axisY, dir.normalize());
  return new THREE.Matrix4().compose(p.clone().add(q).multiplyScalar(0.5), quat, new THREE.Vector3(1, len, 1));
}

function channelMaterial(base: number) {
  return new THREE.ShaderMaterial({
    vertexShader: channelVert,
    fragmentShader: channelFrag,
    uniforms: {
      uSweep: { value: 0 },
      uAmp: { value: 0 },
      uBase: { value: base },
      uTime: { value: 0 },
      uColor: { value: new THREE.Color('#58e6ff') },
    },
  });
}

export class Structure {
  root = new THREE.Group();
  rings: Ring[] = [];
  core = new THREE.Group();
  glassGroup = new THREE.Group();
  lattice = new THREE.Group();
  glass: THREE.Mesh;
  coreMats: { m: THREE.MeshPhysicalMaterial; env: number }[] = [];
  latticeNodes: THREE.InstancedMesh;
  latticeLines: THREE.LineSegments;
  photons: THREE.InstancedMesh;
  emitter: THREE.Group = new THREE.Group();
  coreLight: THREE.PointLight;
  glow: THREE.Sprite;
  plate = new THREE.Group();
  plateTop: THREE.MeshPhysicalMaterial;
  iface = new THREE.Group();
  scan: THREE.Mesh;
  spine = new THREE.Group();
  spineLinks: THREE.LineSegments;
  spinePackets: THREE.Points;
  channels: THREE.ShaderMaterial[] = [];
  /** meshes the pointer can hit, index = PARTS index */
  pickables: THREE.Object3D[] = [];
  anchors: Record<string, THREE.Vector3> = {};
  layerR = [0, 0, 0, 0, 0];

  private anchorLocal: { key: string; obj: THREE.Object3D; p: THREE.Vector3 }[] = [];
  private nodePos: THREE.Vector3[] = [];
  private nodeSize: number[] = [];
  private nodeSeed: number[] = [];
  private edges: [number, number][] = [];
  private adj: number[][] = [];
  private photonState: { e: number; t: number; fwd: boolean; speed: number }[] = [];
  private color = new THREE.Color();
  private m4 = new THREE.Matrix4();
  private v3 = new THREE.Vector3();
  private q = new THREE.Quaternion();
  private coreY = 0;
  private scanY = LAYER_Y[0];
  private scanR = LAYER_RADIUS[0];
  private latticeFlash = 0;
  private beat = 0;
  private beatClock = 0;
  private sweep = 0;
  private sweepAmp = 0;
  private time = 0;
  private coreHighlight = 0;
  private coreDim = 0;
  // calibration choreography
  private calib: 'idle' | 'lock' | 'hold' | 'release' = 'idle';
  private calibClock = 0;
  private calibT = 0;
  private calibW: number[] = [0, 0, 0, 0, 0];

  constructor(
    private mats: MaterialSet,
    opts: { segments: number; pixelRatio: number; lite: boolean },
  ) {
    const { segments, lite } = opts;
    const own = (m: THREE.MeshPhysicalMaterial, list: { m: THREE.MeshPhysicalMaterial; env: number }[]) => {
      const c = m.clone();
      list.push({ m: c, env: c.envMapIntensity });
      return c;
    };

    RING_DEFS.forEach((def, i) => {
      const group = new THREE.Group();
      group.matrixAutoUpdate = false;
      const ringMats: { m: THREE.MeshPhysicalMaterial; env: number }[] = [];
      const lights: THREE.Mesh[] = [];
      let body: THREE.Mesh;
      let beams: THREE.Mesh | null = null;
      const hh = def.h / 2;

      if (def.kind === 'bezel') {
        // titanium bezel with a light channel milled into its face
        const c = def.c;
        const prof: [number, number][] = [
          [def.rIn + c, -hh],
          [def.rOut - c, -hh],
          [def.rOut, -hh + c],
          [def.rOut, hh - c],
          [def.rOut - c, hh],
          [1.905, hh],
          [1.905, hh - 0.018],
          [1.86, hh - 0.018],
          [1.86, hh],
          [def.rIn + c, hh],
          [def.rIn, hh - c],
          [def.rIn, -hh + c],
        ];
        const ti = own(this.mats.titanium, ringMats);
        body = new THREE.Mesh(revolve(prof, segments), ti);
        group.add(body);
        const ch = channelMaterial(0.32);
        this.channels.push(ch);
        const tg = new THREE.TorusGeometry(1.8825, 0.006, 6, segments);
        tg.rotateX(-Math.PI / 2);
        const channel = new THREE.Mesh(tg, ch);
        channel.position.y = hh - 0.013;
        group.add(channel);
        // engraved scale
        const ticks: THREE.Matrix4[] = [];
        for (let k = 0; k < 180; k++) {
          const a = (k / 180) * TAU;
          const len = k % 15 === 0 ? 0.09 : k % 5 === 0 ? 0.055 : 0.03;
          ticks.push(radial(a, def.rOut - c - 0.01 - len / 2, hh + 0.0015, len, 1, 1));
          ticks.push(radial(a, def.rOut - c - 0.01 - len / 2, -hh - 0.0015, len, 1, 1));
        }
        group.add(instanced(new THREE.BoxGeometry(1, 0.004, 0.0055), this.mats.engraving, ticks));
        // axle hubs on the ring's own axis, where an outer yoke would hold it
        const chrome = own(this.mats.chrome, ringMats);
        const anod = own(this.mats.anodised, ringMats);
        for (const sgn of [1, -1]) {
          const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.058, 0.07, 40), anod);
          hub.rotation.z = Math.PI / 2;
          hub.position.x = sgn * (def.rOut + 0.03);
          const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.034, 0.04, 32), chrome);
          cap.rotation.z = Math.PI / 2;
          cap.position.x = sgn * (def.rOut + 0.085);
          const ringLight = new THREE.Mesh(new THREE.TorusGeometry(0.044, 0.003, 6, 40), this.mats.light);
          ringLight.rotation.y = Math.PI / 2;
          ringLight.position.x = sgn * (def.rOut + 0.067);
          group.add(hub, cap, ringLight);
        }
        // index blocks on the inner face every 45°
        const blocks: THREE.Matrix4[] = [];
        for (let k = 0; k < 8; k++) blocks.push(radial((k / 8) * TAU + TAU / 16, def.rIn - 0.012, 0, 1, 1, 1));
        group.add(instanced(new THREE.BoxGeometry(0.026, 0.05, 0.07), anod, blocks));
      } else if (def.kind === 'segmented') {
        // anodised segments with gaps; a chrome core band shows through them
        const anod = own(this.mats.anodised, ringMats);
        const n = 16;
        const gap = 0.034;
        const prof = chamferProfile(def);
        const parts: THREE.BufferGeometry[] = [];
        for (let k = 0; k < n; k++) {
          const a0 = (k / n) * TAU + gap / 2;
          parts.push(revolve(prof, Math.max(8, Math.round(segments / n)), a0, TAU / n - gap));
        }
        body = new THREE.Mesh(mergeGeometries(parts)!, anod);
        group.add(body);
        const chrome = own(this.mats.chrome, ringMats);
        group.add(new THREE.Mesh(machinedRing({ rIn: 1.646, rOut: 1.669, h: 0.11, c: 0.004 }, segments), chrome));
        // screw heads, two per segment
        const screws: THREE.Matrix4[] = [];
        for (let k = 0; k < n; k++) {
          const a = ((k + 0.5) / n) * TAU;
          for (const y of [0.068, -0.068]) {
            const m = new THREE.Matrix4().compose(
              new THREE.Vector3(Math.cos(a) * (def.rOut + 0.001), y, Math.sin(a) * (def.rOut + 0.001)),
              new THREE.Quaternion().setFromUnitVectors(axisY, new THREE.Vector3(Math.cos(a), 0, Math.sin(a))),
              new THREE.Vector3(1, 1, 1),
            );
            screws.push(m);
          }
        }
        group.add(instanced(new THREE.CylinderGeometry(0.009, 0.009, 0.005, 12), chrome, screws));
        // light line on the outer face
        const tg = new THREE.TorusGeometry(def.rOut + 0.0025, 0.0042, 6, 220, 2.4);
        const arc = new THREE.Mesh(tg, this.mats.light);
        arc.rotation.x = -Math.PI / 2;
        lights.push(arc);
        group.add(arc);
      } else if (def.kind === 'gear') {
        // polished chrome gear: teeth on the rim, a ring of recesses, an inner step
        const chrome = own(this.mats.chrome, ringMats);
        body = new THREE.Mesh(machinedRing(def, segments), chrome);
        group.add(body);
        const teeth: THREE.Matrix4[] = [];
        const nT = lite ? 72 : 120;
        for (let k = 0; k < nT; k++) teeth.push(radial((k / nT) * TAU, def.rOut + 0.014, 0));
        group.add(instanced(new THREE.BoxGeometry(0.03, 0.034, 0.02), chrome, teeth));
        const holes: THREE.Matrix4[] = [];
        for (let k = 0; k < 24; k++) {
          const a = (k / 24) * TAU;
          for (const y of [hh + 0.0008, -hh - 0.0008]) holes.push(new THREE.Matrix4().makeTranslation(Math.cos(a) * 1.44, y, Math.sin(a) * 1.44));
        }
        group.add(instanced(new THREE.CylinderGeometry(0.024, 0.024, 0.003, 20), this.mats.engraving, holes));
        const graphite = own(this.mats.graphite, ringMats);
        group.add(new THREE.Mesh(machinedRing({ rIn: 1.318, rOut: 1.345, h: 0.075, c: 0.005 }, segments), graphite));
      } else if (def.kind === 'truss') {
        // two thin titanium bands held apart by a zig-zag of struts
        const ti = own(this.mats.titanium, ringMats);
        const band = (y: number) => {
          const g = machinedRing({ rIn: 1.12, rOut: 1.17, h: 0.028, c: 0.006 }, segments);
          g.translate(0, y, 0);
          return g;
        };
        body = new THREE.Mesh(mergeGeometries([band(0.066), band(-0.066)])!, ti);
        group.add(body);
        const chrome = own(this.mats.chrome, ringMats);
        const struts: THREE.Matrix4[] = [];
        const joints: THREE.Matrix4[] = [];
        const nS = lite ? 32 : 48;
        const rM = 1.145;
        for (let k = 0; k < nS; k++) {
          const a0 = (k / nS) * TAU;
          const a1 = ((k + 1) / nS) * TAU;
          const up = k % 2 === 0;
          const p = new THREE.Vector3(Math.cos(a0) * rM, up ? 0.052 : -0.052, Math.sin(a0) * rM);
          const q = new THREE.Vector3(Math.cos(a1) * rM, up ? -0.052 : 0.052, Math.sin(a1) * rM);
          struts.push(span(p, q));
          joints.push(new THREE.Matrix4().makeTranslation(p.x, p.y, p.z));
        }
        group.add(instanced(new THREE.CylinderGeometry(0.0055, 0.0055, 1, 8), chrome, struts));
        group.add(instanced(new THREE.SphereGeometry(0.011, 10, 8), chrome, joints));
      } else {
        // optical ring: six relays with lenses aimed at the lattice
        const anod = own(this.mats.anodised, ringMats);
        body = new THREE.Mesh(machinedRing(def, segments), anod);
        group.add(body);
        const chrome = own(this.mats.chrome, ringMats);
        const lens = own(this.mats.lens, ringMats);
        const barrels: THREE.Matrix4[] = [];
        const lenses: THREE.Matrix4[] = [];
        const rims: THREE.Matrix4[] = [];
        const beamGeos: THREE.BufferGeometry[] = [];
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * TAU + 0.26;
          const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
          const qd = new THREE.Quaternion().setFromUnitVectors(axisY, dir);
          barrels.push(new THREE.Matrix4().compose(dir.clone().multiplyScalar(0.85), qd, new THREE.Vector3(1, 1, 1)));
          lenses.push(new THREE.Matrix4().compose(dir.clone().multiplyScalar(0.808), qd, new THREE.Vector3(1, 1, 1)));
          rims.push(new THREE.Matrix4().compose(dir.clone().multiplyScalar(0.805), qd, new THREE.Vector3(1, 1, 1)));
          const bg = new THREE.CylinderGeometry(0.0022, 0.0022, 0.12, 6, 1, true);
          bg.translate(0, -0.06, 0); // from the lens inward
          bg.applyMatrix4(new THREE.Matrix4().compose(dir.clone().multiplyScalar(0.8), qd, new THREE.Vector3(1, 1, 1)));
          beamGeos.push(bg);
        }
        group.add(instanced(new THREE.CylinderGeometry(0.03, 0.034, 0.07, 28), chrome, barrels));
        group.add(instanced(new THREE.CylinderGeometry(0.025, 0.025, 0.012, 28), lens, lenses));
        const rimGeo = new THREE.TorusGeometry(0.027, 0.0028, 6, 28);
        rimGeo.rotateX(Math.PI / 2);
        group.add(instanced(rimGeo, this.mats.light, rims));
        beams = new THREE.Mesh(
          mergeGeometries(beamGeos)!,
          new THREE.ShaderMaterial({
            vertexShader: beamVert,
            fragmentShader: beamFrag,
            uniforms: { uTime: { value: 0 }, uOpacity: { value: 1 } },
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          }),
        );
        group.add(beams);
        const tg = new THREE.TorusGeometry((def.rIn + def.rOut) / 2, 0.004, 6, 220, 1.6);
        const arc = new THREE.Mesh(tg, this.mats.light);
        arc.rotation.x = -Math.PI / 2;
        arc.position.y = hh + 0.003;
        lights.push(arc);
        group.add(arc);
      }

      // data packets riding the ring
      let packets: THREE.Points | null = null;
      if (def.packets > 0) {
        const r = rng(11 + i);
        const trail = 7;
        const n = def.packets * trail;
        const aPhase = new Float32Array(n);
        const aSpeed = new Float32Array(n);
        const aTrail = new Float32Array(n);
        for (let p = 0; p < def.packets; p++) {
          const ph = r() * TAU;
          const sp = (0.22 + r() * 0.3) * (r() < 0.5 ? -1 : 1);
          for (let t = 0; t < trail; t++) {
            aPhase[p * trail + t] = ph;
            aSpeed[p * trail + t] = sp;
            aTrail[p * trail + t] = t;
          }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
        g.setAttribute('aPhase', new THREE.BufferAttribute(aPhase, 1));
        g.setAttribute('aSpeed', new THREE.BufferAttribute(aSpeed, 1));
        g.setAttribute('aTrail', new THREE.BufferAttribute(aTrail, 1));
        const band = def.h > 0.1;
        packets = new THREE.Points(
          g,
          new THREE.ShaderMaterial({
            vertexShader: packetVert,
            fragmentShader: packetFrag,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            uniforms: {
              uTime: { value: 0 },
              uR: { value: band ? def.rOut + 0.007 : (def.rIn + def.rOut) / 2 },
              uY: { value: band ? (def.kind === 'truss' ? 0.084 : 0) : hh + 0.006 },
              uSize: { value: 5.5 },
              uPR: { value: opts.pixelRatio },
              uBoost: { value: 0 },
              uColor: { value: new THREE.Color('#9ff4ff') },
              uOpacity: { value: 1 },
            },
          }),
        );
        packets.frustumCulled = false;
        group.add(packets);
      }

      this.root.add(group);
      this.pickables[i] = body;
      body.userData.part = i;
      this.rings.push({ def, group, body, mats: ringMats, pins: null, lights, beams, packets, angle: def.base, vel: 0, spin: 0, qGimbal: new THREE.Quaternion(), highlight: 0, dim: 0 });
    });

    // bearings: shaft, housing in the parent, collar on the child
    for (let i = 1; i < this.rings.length; i++) {
      const parent = this.rings[i - 1];
      const child = this.rings[i];
      const pins = new THREE.Group();
      const len = parent.def.rIn - child.def.rOut + 0.024;
      const mid = (parent.def.rIn + child.def.rOut) / 2;
      const shaft = new THREE.CylinderGeometry(0.014, 0.014, len, 20);
      const housing = new THREE.CylinderGeometry(0.036, 0.04, 0.03, 32);
      const collar = new THREE.CylinderGeometry(0.024, 0.024, 0.018, 24);
      const ringGeo = new THREE.TorusGeometry(0.037, 0.0035, 6, 32);
      const chrome = parent.mats.find((x) => x.m.metalness === 1 && x.m.roughness < 0.1)?.m ?? this.mats.chrome;
      for (const sgn of [1, -1]) {
        const g = new THREE.Group();
        const s = new THREE.Mesh(shaft, chrome);
        s.position.y = mid;
        const h = new THREE.Mesh(housing, this.mats.anodised);
        h.position.y = parent.def.rIn - 0.004;
        const c = new THREE.Mesh(collar, chrome);
        c.position.y = child.def.rOut + 0.006;
        const lr = new THREE.Mesh(ringGeo, this.mats.light);
        lr.rotation.x = Math.PI / 2;
        lr.position.y = parent.def.rIn - 0.02;
        g.add(s, h, c, lr);
        // the group is built along +Y; turn it onto the child's axis
        if (child.def.axis === 'z') g.rotation.x = sgn > 0 ? Math.PI / 2 : -Math.PI / 2;
        else g.rotation.z = sgn > 0 ? -Math.PI / 2 : Math.PI / 2;
        pins.add(g);
      }
      parent.group.add(pins);
      parent.pins = pins;
    }

    /* core: faceted glass in a chrome frame, a lattice of light inside --- */
    this.root.add(this.core);
    this.core.add(this.glassGroup, this.lattice, this.emitter);

    const glassGeo = new THREE.IcosahedronGeometry(0.64, 0);
    const glassMat = this.mats.glass.clone();
    this.coreMats.push({ m: glassMat, env: glassMat.envMapIntensity });
    this.glass = new THREE.Mesh(glassGeo, glassMat);
    this.glass.renderOrder = 2;
    this.glassGroup.add(this.glass);
    this.pickables[5] = this.glass;
    this.glass.userData.part = 5;

    // frame along the icosahedron's 30 edges and 12 vertices
    const frameChrome = this.mats.chrome.clone();
    this.coreMats.push({ m: frameChrome, env: frameChrome.envMapIntensity });
    const verts: THREE.Vector3[] = [];
    const pa = glassGeo.getAttribute('position');
    for (let k = 0; k < pa.count; k++) {
      const v = new THREE.Vector3().fromBufferAttribute(pa, k).multiplyScalar(1.004);
      if (!verts.some((u) => u.distanceToSquared(v) < 1e-6)) verts.push(v);
    }
    const edgeLen = Math.min(...verts.slice(1).map((v) => v.distanceTo(verts[0])));
    const frameEdges: THREE.Matrix4[] = [];
    for (let a = 0; a < verts.length; a++)
      for (let b = a + 1; b < verts.length; b++) if (Math.abs(verts[a].distanceTo(verts[b]) - edgeLen) < 1e-3) frameEdges.push(span(verts[a], verts[b]));
    this.glassGroup.add(instanced(new THREE.CylinderGeometry(0.0055, 0.0055, 1, 8), frameChrome, frameEdges));
    this.glassGroup.add(instanced(new THREE.SphereGeometry(0.014, 12, 10), frameChrome, verts.map((v) => new THREE.Matrix4().makeTranslation(v.x, v.y, v.z))));

    // lattice: three shells plus a centre, linked within and between shells
    const shells: [number, number, number][] = [
      [lite ? 60 : 84, 0.42, 0.011],
      [lite ? 26 : 36, 0.26, 0.015],
      [12, 0.13, 0.019],
    ];
    shells.forEach(([n, r, size]) => {
      for (const p of fibonacciSphere(n, r)) {
        this.nodePos.push(p);
        this.nodeSize.push(size);
      }
    });
    const rr = rng(5);
    this.nodeSeed = this.nodePos.map(() => rr());
    const shellOf = (i: number) => (i < shells[0][0] ? 0 : i < shells[0][0] + shells[1][0] ? 1 : 2);
    const seen = new Set<string>();
    const link = (i: number, j: number) => {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (seen.has(key) || i === j) return;
      seen.add(key);
      this.edges.push([i, j]);
    };
    this.nodePos.forEach((p, i) => {
      const same = this.nodePos
        .map((q, j) => ({ j, d: p.distanceToSquared(q) }))
        .filter((o) => o.j !== i && shellOf(o.j) === shellOf(i))
        .sort((a, b) => a.d - b.d)
        .slice(0, 3);
      for (const { j } of same) link(i, j);
      if (shellOf(i) < 2) {
        const inner = this.nodePos
          .map((q, j) => ({ j, d: p.distanceToSquared(q) }))
          .filter((o) => shellOf(o.j) === shellOf(i) + 1)
          .sort((a, b) => a.d - b.d)[0];
        if (inner) link(i, inner.j);
      }
    });
    this.adj = this.nodePos.map(() => []);
    this.edges.forEach(([a, b], k) => {
      this.adj[a].push(k);
      this.adj[b].push(k);
    });
    const seg: number[] = [];
    for (const [a, b] of this.edges) seg.push(...this.nodePos[a].toArray(), ...this.nodePos[b].toArray());
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
    this.latticeLines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: new THREE.Color('#4fbfd6'), toneMapped: false }));
    this.lattice.add(this.latticeLines);

    this.latticeNodes = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ toneMapped: false }), this.nodePos.length);
    this.nodePos.forEach((p, i) => {
      this.m4.compose(p, this.q.identity(), this.v3.setScalar(this.nodeSize[i]));
      this.latticeNodes.setMatrixAt(i, this.m4);
      this.latticeNodes.setColorAt(i, this.color.set('#ffffff'));
    });
    this.lattice.add(this.latticeNodes);

    // photons travelling the lattice edges
    const nPh = lite ? 30 : 72;
    this.photons = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.0085, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color('#d8fbff').multiplyScalar(2.2), toneMapped: false }), nPh);
    for (let k = 0; k < nPh; k++) this.photonState.push({ e: Math.floor(rr() * this.edges.length), t: rr(), fwd: rr() < 0.5, speed: 0.6 + rr() * 0.9 });
    this.lattice.add(this.photons);

    // photonic emitter at the centre: a hot point inside two gimballed hoops
    const hot = new THREE.Mesh(new THREE.IcosahedronGeometry(0.038, 2), new THREE.MeshBasicMaterial({ color: new THREE.Color('#e9feff').multiplyScalar(2.6), toneMapped: false }));
    const hoopA = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.0022, 6, 64), this.mats.light);
    const hoopB = new THREE.Mesh(new THREE.TorusGeometry(0.098, 0.0018, 6, 64), this.mats.lightDim);
    hoopB.rotation.x = Math.PI / 2;
    this.emitter.add(hot, hoopA, hoopB);

    this.coreLight = new THREE.PointLight('#a6efff', 0, 4.2, 2);
    this.core.add(this.coreLight);

    const glowTex = radialTexture();
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#7eeaff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.4 }));
    this.glow.scale.setScalar(1.1);
    this.glow.renderOrder = 3;
    this.core.add(this.glow);

    /* substrate plate (architecture only) ------------------------------- */
    const plateGeo = new THREE.CylinderGeometry(2.24, 2.24, 0.045, 160, 1);
    this.plateTop = new THREE.MeshPhysicalMaterial({
      color: '#15181b',
      metalness: 0.55,
      roughness: 0.38,
      clearcoat: 1,
      clearcoatRoughness: 0.1,
      emissive: new THREE.Color('#38e1ff'),
      emissiveMap: circuitTexture(),
      emissiveIntensity: 0.35,
    });
    const plate = new THREE.Mesh(plateGeo, [mats.graphite, this.plateTop, mats.graphite]);
    plate.userData.part = 6;
    this.pickables[6] = plate;
    const rim = new THREE.Mesh(machinedRing({ rIn: 2.2, rOut: 2.32, h: 0.08, c: 0.012 }, segments), mats.chrome);
    this.plate.add(plate, rim);
    this.plate.visible = false;
    this.root.add(this.plate);

    /* interface pane (architecture only) -------------------------------- */
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.74, 0.74, 0.03, 96), mats.glassPane);
    disc.userData.part = 7;
    this.pickables[7] = disc;
    const dialRim = new THREE.Mesh(machinedRing({ rIn: 0.74, rOut: 0.79, h: 0.05, c: 0.008 }, segments), mats.chrome);
    const dialMarks = new THREE.Mesh(
      new THREE.CircleGeometry(0.7, 96),
      new THREE.MeshBasicMaterial({ map: dialTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    dialMarks.rotation.x = -Math.PI / 2;
    dialMarks.position.y = 0.017;
    this.iface.add(disc, dialRim, dialMarks);
    this.iface.visible = false;
    this.root.add(this.iface);

    /* scan ring: marks the active architecture layer -------------------- */
    this.scan = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.0035, 6, 256),
      new THREE.MeshBasicMaterial({ color: new THREE.Color('#5fe9ff').multiplyScalar(1.4), transparent: true, opacity: 0, toneMapped: false, depthWrite: false }),
    );
    this.scan.rotation.x = -Math.PI / 2;
    this.root.add(this.scan);

    /* spine: three rods tie the layers together, data rides along them -- */
    const rodGeo = new THREE.CylinderGeometry(0.009, 0.009, 1, 10);
    const capGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.03, 16);
    const spineAngles = [Math.PI * 0.5, Math.PI * 1.17, Math.PI * 1.83];
    for (const a of spineAngles) {
      const rod = new THREE.Mesh(rodGeo, mats.chrome);
      rod.position.set(Math.cos(a) * 2.5, 0, Math.sin(a) * 2.5);
      rod.userData.rod = true;
      const top = new THREE.Mesh(capGeo, mats.anodised);
      top.userData.cap = 1;
      const bottom = new THREE.Mesh(capGeo, mats.anodised);
      bottom.userData.cap = -1;
      top.position.set(rod.position.x, 0, rod.position.z);
      bottom.position.copy(top.position);
      this.spine.add(rod, top, bottom);
    }
    this.spineLinks = new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(spineAngles.length * 5 * 6), 3)),
      new THREE.LineBasicMaterial({ color: '#7fdff0', transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.spineLinks.frustumCulled = false;
    this.spine.add(this.spineLinks);
    const nSp = 36;
    const sg = new THREE.BufferGeometry();
    const sAng = new Float32Array(nSp);
    const sPh = new Float32Array(nSp);
    const sSp = new Float32Array(nSp);
    for (let k = 0; k < nSp; k++) {
      sAng[k] = spineAngles[k % 3];
      sPh[k] = rr();
      sSp[k] = (0.12 + rr() * 0.16) * (k % 2 ? 1 : -1);
    }
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nSp * 3), 3));
    sg.setAttribute('aAng', new THREE.BufferAttribute(sAng, 1));
    sg.setAttribute('aPhase', new THREE.BufferAttribute(sPh, 1));
    sg.setAttribute('aSpeed', new THREE.BufferAttribute(sSp, 1));
    this.spinePackets = new THREE.Points(
      sg,
      new THREE.ShaderMaterial({
        vertexShader: spineVert,
        fragmentShader: spineFrag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 }, uY0: { value: -1.9 }, uY1: { value: 2.0 }, uR: { value: 2.5 }, uPR: { value: opts.pixelRatio }, uOpacity: { value: 0 } },
      }),
    );
    this.spinePackets.frustumCulled = false;
    this.spine.add(this.spinePackets);
    this.spine.visible = false;
    this.root.add(this.spine);

    /* callout anchors ------------------------------------------------- */
    const r0 = this.rings[0].def;
    this.addAnchor('energy', this.rings[0].group, new THREE.Vector3(Math.cos(-0.5) * r0.rOut, r0.h / 2, Math.sin(-0.5) * r0.rOut));
    this.addAnchor('time', this.rings[1].group, new THREE.Vector3(this.rings[1].def.rOut, 0, 0));
    this.addAnchor('space', this.rings[2].group, new THREE.Vector3(Math.cos(2.4) * 1.56, 0, Math.sin(2.4) * 1.56));
    this.addAnchor('bearing', this.rings[0].group, new THREE.Vector3(0, 0, -(r0.rIn - 0.02)));
    this.addAnchor('risk', this.rings[3].group, new THREE.Vector3(-this.rings[3].def.rOut, 0.066, 0));
    this.addAnchor('intent', this.rings[4].group, new THREE.Vector3(Math.cos(0.26) * 0.95, 0.02, Math.sin(0.26) * 0.95));
    this.addAnchor('lattice', this.lattice, new THREE.Vector3(0.18, 0.3, 0.2));
    for (let l = 0; l < 5; l++) this.anchors[`layer${l}`] = new THREE.Vector3();
  }

  private addAnchor(key: string, obj: THREE.Object3D, p: THREE.Vector3) {
    this.anchorLocal.push({ key, obj, p });
    this.anchors[key] = new THREE.Vector3();
  }

  /** Resolve event: new rest configuration and a burst of energy. */
  kick(seed: number) {
    const r = rng(seed);
    this.rings.forEach((ring, i) => {
      ring.def.base = (r() - 0.5) * 2.6 + (i === 0 ? 1.2 : 0);
      ring.vel += (r() < 0.5 ? -1 : 1) * (2.5 + r() * 3);
    });
    this.latticeFlash = 1;
    this.triggerBeat(1);
  }

  impulse(v: number) {
    this.rings.forEach((ring, i) => (ring.vel += v * (0.6 + i * 0.25)));
  }

  /** A synchronised light pulse: lattice, channel sweep, relay beams. */
  triggerBeat(strength = 0.6) {
    this.beat = Math.max(this.beat, strength);
    this.sweepAmp = Math.max(this.sweepAmp, strength);
    this.sweep = 0;
  }

  update(dt: number, s: StructureState) {
    this.time += dt;
    const t = this.time;
    const { explode, charge, inspect } = s;

    /* --- choreography: idle calibration cycles ----------------------- */
    const free = s.calibrate && explode < 0.05 && s.display < 0.05 && s.cta < 0.05 && inspect < 0.05 && charge < 0.01;
    this.calibClock += dt;
    if (!free && this.calib !== 'idle' && this.calib !== 'release') {
      this.calib = 'release';
      this.calibT = 0;
    }
    if (this.calib === 'idle' && free && this.calibClock > 11) {
      this.calib = 'lock';
      this.calibT = 0;
    }
    this.calibT += dt;
    if (this.calib === 'lock') {
      this.calibW = this.calibW.map((_, i) => smoothstep(i * 0.16, i * 0.16 + 1.0, this.calibT));
      if (this.calibT > 1.9) {
        this.calib = 'hold';
        this.calibT = 0;
        this.triggerBeat(1);
        this.latticeFlash = 0.7;
      }
    } else if (this.calib === 'hold') {
      if (this.calibT > 1.7) {
        this.calib = 'release';
        this.calibT = 0;
      }
    } else if (this.calib === 'release') {
      this.calibW = this.calibW.map((w) => Math.max(0, w - dt / 1.1));
      if (this.calibW.every((w) => w === 0)) {
        this.calib = 'idle';
        this.calibClock = 0;
      }
    }

    // regular heartbeat
    this.beatClock += dt;
    if (this.beatClock > 2.6) {
      this.beatClock = 0;
      this.triggerBeat(0.45);
    }
    this.beat = Math.max(0, this.beat - dt * 1.6);
    this.sweep += dt * 4.2;
    this.sweepAmp = Math.max(0, this.sweepAmp - dt * 0.45);

    /* --- gimbal physics ------------------------------------------------ */
    let parentQ = new THREE.Quaternion();
    const inspectAngles = [1.2, 0.95, 1.25, 0.6, 1.05];
    this.rings.forEach((ring, i) => {
      const d = ring.def;
      const w = this.calibW[i];
      ring.spin += d.omega * dt * (1 + charge * 9) * (1 - w);
      const near = (target: number) => ring.angle + wrap(target - ring.angle);
      const hero = d.base + d.amp * Math.sin(t * d.freq * (1 + charge * 2) + d.phase) + ring.spin;
      let target = near(hero);
      target = lerp(target, near(i === 0 ? hero : 0), w); // calibration: coplanar with the bezel
      target = lerp(target, near(d.display + 0.05 * Math.sin(t * 0.4 + i)), s.display);
      target = lerp(target, near(inspectAngles[i] + 0.04 * Math.sin(t * 0.5 + i)), inspect * (1 - s.display));
      target = lerp(target, near(d.cta + 0.07 * Math.sin(t * 0.3 + i * 1.7)), s.cta);
      const K = lerp(7.5, 16, Math.max(w, inspect));
      const C = 2 * Math.sqrt(K) * lerp(0.62, 1.0, Math.max(w, inspect));
      ring.vel += (K * wrap(target - ring.angle) - C * ring.vel) * dt;
      ring.angle += ring.vel * dt;
      this.q.setFromAxisAngle(d.axis === 'x' ? axisX : axisZ, ring.angle);
      ring.qGimbal.copy(parentQ).multiply(this.q);
      parentQ = ring.qGimbal;
    });

    /* --- layout: gimbal / inspect / architecture stack ---------------- */
    const active = s.layer;
    const liftFor = (layer: number) => {
      const above = smoothstep(active - 0.5, active + 0.5, layer - 0.5);
      const at = 1 - Math.min(1, Math.abs(layer - active));
      return above * 0.42 + at * 0.16;
    };
    const ex = smoothstep(0, 1, explode);
    const hidePins = Math.max(smoothstep(0, 0.35, explode), smoothstep(0, 0.4, inspect));
    const pos = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const qStack = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    this.rings.forEach((ring, i) => {
      const d = ring.def;
      qStack.setFromAxisAngle(axisY, t * 0.05 * (i % 2 ? 1 : -1) + i * 0.6);
      const q = ring.qGimbal.clone().slerp(qStack, ex);
      normal.copy(axisY).applyQuaternion(ring.qGimbal);
      pos.set(0, (d.stackY + liftFor(d.layer)) * ex, 0).addScaledVector(normal, d.inspect * inspect * (1 - ex));
      ring.group.matrix.compose(pos, q, one);
      ring.group.matrixWorldNeedsUpdate = true;
      if (ring.pins) {
        ring.pins.visible = hidePins < 0.99;
        ring.pins.scale.setScalar(Math.max(1 - hidePins, 0.0001));
      }
      ring.lights.forEach((l, k) => (l.rotation.z = t * 0.35 * (i % 2 ? 1 : -1) + k));
      if (ring.packets) {
        const u = (ring.packets.material as THREE.ShaderMaterial).uniforms;
        u.uTime.value = t;
        u.uBoost.value = charge;
        u.uOpacity.value = s.glow;
      }
      if (ring.beams) {
        const u = (ring.beams.material as THREE.ShaderMaterial).uniforms;
        u.uTime.value = t;
        u.uOpacity.value = s.glow * (0.35 + this.beat * 1.2 + charge) * (1 - ex) * (1 - inspect * 0.6);
      }

      // hover highlight and architecture isolation
      const isActiveLayer = Math.abs(d.layer - Math.round(active)) < 0.5;
      ring.highlight += ((s.hover === i ? 1 : 0) - ring.highlight) * Math.min(1, dt * 10);
      ring.dim += ((explode > 0.5 && !isActiveLayer ? 0.78 : 0) - ring.dim) * Math.min(1, dt * 5);
      for (const { m, env } of ring.mats) {
        m.envMapIntensity = env * (1 - ring.dim) * (1 + ring.highlight * 0.35);
        m.emissive.setRGB(0.02, 0.17, 0.21).multiplyScalar(ring.highlight);
      }
    });
    for (const ch of this.channels) {
      ch.uniforms.uSweep.value = this.sweep;
      ch.uniforms.uAmp.value = this.sweepAmp * s.glow;
      ch.uniforms.uBase.value = (0.3 + this.rings[0].highlight * 0.5 + charge * 0.6) * s.glow * (1 - this.rings[0].dim);
      ch.uniforms.uTime.value = t;
    }

    /* --- core ------------------------------------------------------------ */
    this.coreY = (LAYER_Y[2] + liftFor(2)) * ex;
    this.core.position.y = this.coreY;
    const coreScale = (1 + charge * 0.08 + this.latticeFlash * 0.05) * (1 - s.cta * 0.55) * (1 + inspect * 0.12);
    this.core.scale.setScalar(coreScale);
    this.glassGroup.rotation.set(Math.sin(t * 0.17) * 0.2, t * 0.12, 0);
    // inspect: the glass lifts off and the lattice is seen directly
    this.glassGroup.position.y = inspect * 1.05 * (1 - ex);
    this.glassGroup.scale.setScalar(1 - inspect * 0.18);
    this.lattice.rotation.set(t * 0.07, -t * 0.3 * (1 + charge * 3), 0);
    this.emitter.rotation.set(t * 0.9, t * 0.6, 0);
    this.emitter.children[1].rotation.y = t * 1.7;

    this.latticeFlash = Math.max(0, this.latticeFlash - dt * 1.4);
    const coreActive = Math.abs(2 - Math.round(active)) < 0.5;
    this.coreHighlight += ((s.hover === 5 ? 1 : 0) - this.coreHighlight) * Math.min(1, dt * 10);
    this.coreDim += ((explode > 0.5 && !coreActive ? 0.75 : 0) - this.coreDim) * Math.min(1, dt * 5);
    const g = s.glow * (1 - s.cta * 0.4) * (1 - this.coreDim * 0.7);
    for (let i = 0; i < this.nodePos.length; i++) {
      const p = this.nodePos[i];
      const wave = 0.5 + 0.5 * Math.sin(t * (2.2 + charge * 6) - p.y * 9 + this.nodeSeed[i] * 6);
      const b = (0.28 + Math.pow(wave, 6) * 1.4 + charge * 1.2 + this.latticeFlash * 2 + this.beat * 0.8 * (1 - p.length() * 1.5) + this.coreHighlight * 0.5) * g;
      this.color.setRGB(0.55 * b, 0.93 * b, 1.0 * b);
      this.latticeNodes.setColorAt(i, this.color);
    }
    this.latticeNodes.instanceColor!.needsUpdate = true;
    (this.latticeLines.material as THREE.LineBasicMaterial).color
      .setRGB(0.26, 0.66, 0.78)
      .multiplyScalar((0.36 + charge * 0.9 + this.latticeFlash * 1.2 + this.beat * 0.4 + this.coreHighlight * 0.5) * g);

    // photons walk the lattice graph
    const speedK = 1 + charge * 4 + this.beat * 1.5;
    this.photonState.forEach((ph, k) => {
      const [a, b] = this.edges[ph.e];
      const pa = this.nodePos[a];
      const pb = this.nodePos[b];
      ph.t += (dt * ph.speed * speedK) / Math.max(0.05, pa.distanceTo(pb)) * 0.12;
      if (ph.t >= 1) {
        const at = ph.fwd ? b : a;
        const options = this.adj[at];
        const next = options[Math.floor(Math.random() * options.length)];
        ph.e = next;
        ph.fwd = this.edges[next][0] === at;
        ph.t = 0;
      }
      const [a2, b2] = this.edges[ph.e];
      const from = this.nodePos[ph.fwd ? a2 : b2];
      const to = this.nodePos[ph.fwd ? b2 : a2];
      this.v3.copy(from).lerp(to, ph.t);
      this.m4.compose(this.v3, this.q.identity(), this.m4Scale(g));
      this.photons.setMatrixAt(k, this.m4);
    });
    this.photons.instanceMatrix.needsUpdate = true;

    // internal light is for the assembled object; in the exploded stack it would wash the plate
    this.coreLight.intensity = (1.6 + this.beat * 3 + charge * 4 + this.latticeFlash * 4) * g * (1 - inspect * 0.3) * (1 - ex);
    (this.glow.material as THREE.SpriteMaterial).opacity = (0.22 + charge * 0.4 + this.latticeFlash * 0.5 + this.beat * 0.15) * g;
    for (const { m, env } of this.coreMats) {
      m.envMapIntensity = env * (1 - this.coreDim * 0.8) * (1 + this.coreHighlight * 0.3);
      if (m.metalness === 1) m.emissive.setRGB(0.02, 0.17, 0.21).multiplyScalar(this.coreHighlight);
    }

    /* --- plate / interface / scan / spine ------------------------------ */
    const showArch = smoothstep(0.35, 0.95, explode);
    const plateOn = Math.abs(0 - Math.round(active)) < 0.5;
    const ifaceOn = Math.abs(4 - Math.round(active)) < 0.5;
    this.plate.visible = showArch > 0.01;
    this.plate.position.y = LAYER_Y[0] + liftFor(0) - (1 - showArch) * 0.6;
    this.plate.scale.setScalar(Math.max(0.0001, showArch));
    this.plate.rotation.y = t * 0.03;
    this.plateTop.emissiveIntensity = (plateOn ? 1.35 : 0.12) * showArch;
    this.plateTop.envMapIntensity = plateOn ? 1 : 0.35;
    this.iface.visible = showArch > 0.01;
    this.iface.position.y = LAYER_Y[4] + 0.32 + liftFor(4) + (1 - showArch) * 0.6;
    this.iface.scale.setScalar(Math.max(0.0001, showArch));
    this.iface.rotation.y = -t * 0.08;
    ((this.iface.children[2] as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = ifaceOn ? 1 : 0.3;

    const li = clamp(Math.round(active), 0, 4);
    const ty = (li === 4 ? LAYER_Y[4] + 0.16 : LAYER_Y[li]) + liftFor(li);
    this.scanY += (ty - this.scanY) * Math.min(1, dt * 5);
    this.scanR += (LAYER_RADIUS[li] * 1.14 - this.scanR) * Math.min(1, dt * 5);
    this.scan.position.y = this.scanY;
    this.scan.scale.setScalar(this.scanR);
    (this.scan.material as THREE.MeshBasicMaterial).opacity = showArch * (0.75 + 0.25 * Math.sin(t * 3));

    this.spine.visible = showArch > 0.01;
    if (this.spine.visible) {
      const y0 = this.plate.position.y;
      const y1 = this.iface.position.y;
      for (const ch of this.spine.children) {
        if (ch.userData.rod) {
          ch.position.y = (y0 + y1) / 2;
          ch.scale.set(1, Math.max(0.001, (y1 - y0) * showArch), 1);
        } else if (ch.userData.cap) ch.position.y = ch.userData.cap > 0 ? y1 : y0;
      }
      // links from each rod to every layer's rim
      const ys = [this.plate.position.y, (LAYER_Y[1] + liftFor(1)) * ex, this.coreY, (LAYER_Y[3] + liftFor(3)) * ex, this.iface.position.y];
      const rs = [2.3, 2.03, 0.66, 1.54, 0.79];
      const arr = this.spineLinks.geometry.getAttribute('position') as THREE.BufferAttribute;
      let k = 0;
      for (const a of [Math.PI * 0.5, Math.PI * 1.17, Math.PI * 1.83]) {
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        for (let l = 0; l < 5; l++) {
          arr.setXYZ(k++, ca * 2.5, ys[l], sa * 2.5);
          arr.setXYZ(k++, ca * rs[l], ys[l], sa * rs[l]);
        }
      }
      arr.needsUpdate = true;
      (this.spineLinks.material as THREE.LineBasicMaterial).opacity = 0.28 * showArch;
      const u = (this.spinePackets.material as THREE.ShaderMaterial).uniforms;
      u.uTime.value = t;
      u.uY0.value = y0;
      u.uY1.value = y1;
      u.uOpacity.value = showArch;
    }

    /* --- anchors ---------------------------------------------------------- */
    this.root.updateMatrixWorld(true);
    for (const a of this.anchorLocal) this.anchors[a.key].copy(a.p).applyMatrix4(a.obj.matrixWorld);
    for (let l = 0; l < 5; l++) {
      const y = l === 2 ? this.coreY : l === 0 ? this.plate.position.y : l === 4 ? this.iface.position.y - 0.16 : (LAYER_Y[l] + liftFor(l)) * ex;
      this.anchors[`layer${l}`].set(0, y, 0).applyMatrix4(this.root.matrixWorld);
      this.layerR[l] = LAYER_RADIUS[l] * this.root.scale.x * (l === 2 ? 0.9 : 1);
    }
  }

  private scaleV = new THREE.Vector3();
  private m4Scale(g: number) {
    return this.scaleV.setScalar(Math.max(0.0001, 0.6 + g * 0.6));
  }
}

function wrap(a: number) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

function radialTexture() {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.15, 'rgba(255,255,255,0.45)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.08)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function dialTexture() {
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;
  const c = S / 2;
  ctx.strokeStyle = 'rgba(120,235,255,0.9)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 120; i++) {
    const a = (i / 120) * TAU;
    const long = i % 10 === 0;
    const r0 = S * (long ? 0.4 : 0.43);
    ctx.globalAlpha = long ? 0.9 : 0.4;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
    ctx.lineTo(c + Math.cos(a) * S * 0.46, c + Math.sin(a) * S * 0.46);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(c, c, S * 0.33, -0.4, 1.9);
  ctx.stroke();
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 1;
  for (const rr of [0.25, 0.18]) {
    ctx.beginPath();
    ctx.arc(c, c, S * rr, 0, TAU);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.moveTo(c - S * 0.1, c);
  ctx.lineTo(c + S * 0.1, c);
  ctx.moveTo(c, c - S * 0.1);
  ctx.lineTo(c, c + S * 0.1);
  ctx.stroke();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
