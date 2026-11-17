import * as THREE from 'three';
import type { MaterialSet } from './materials';
import { rng, TAU } from '../util/math';

const vert = /* glsl */ `
  attribute float aRadius;
  attribute float aTheta;
  attribute float aPhi;
  attribute float aSpeed;
  attribute float aSize;
  attribute float aSeed;
  attribute float aCyan;
  uniform float uTime;
  uniform float uContract;
  uniform float uSpread;
  uniform float uPulseR;
  uniform float uPulseAmp;
  uniform float uPR;
  varying float vA;
  varying float vCyan;
  void main() {
    float th = aTheta + uTime * aSpeed * (1.0 + uContract * 6.0);
    float r = aRadius * mix(1.0, 0.34, uContract) * uSpread;
    float ph = aPhi + sin(uTime * 0.2 + aSeed * 6.28) * 0.05;
    vec3 p = vec3(cos(ph) * cos(th), sin(ph) * 0.62, cos(ph) * sin(th)) * r;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float tw = 0.5 + 0.5 * sin(uTime * (0.6 + aSeed * 1.8) + aSeed * 40.0);
    float pulse = uPulseAmp * exp(-pow((length(p) - uPulseR) * 2.2, 2.0));
    vA = (0.25 + 0.75 * tw * tw) + pulse * 2.0;
    vCyan = aCyan;
    gl_PointSize = aSize * uPR * (1.0 + pulse) * (8.0 / -mv.z);
  }`;

const frag = /* glsl */ `
  uniform float uOpacity;
  varying float vA;
  varying float vCyan;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.05, d);
    vec3 col = mix(vec3(0.86, 0.9, 0.95), vec3(0.37, 0.91, 1.0), vCyan);
    gl_FragColor = vec4(col, a * vA * uOpacity);
  }`;

export class Particles {
  points: THREE.Points;
  uniforms: Record<string, THREE.IUniform>;

  constructor(count: number, pixelRatio: number) {
    const r = rng(99);
    const attr = (n: number) => new Float32Array(n);
    const aRadius = attr(count);
    const aTheta = attr(count);
    const aPhi = attr(count);
    const aSpeed = attr(count);
    const aSize = attr(count);
    const aSeed = attr(count);
    const aCyan = attr(count);
    for (let i = 0; i < count; i++) {
      // most particles in a loose shell, a few far out for depth
      const far = r() < 0.18;
      aRadius[i] = far ? 4.6 + r() * 3.5 : 2.35 + Math.pow(r(), 1.6) * 2.2;
      aTheta[i] = r() * TAU;
      aPhi[i] = (r() * 2 - 1) * 1.2;
      aSpeed[i] = (0.02 + r() * 0.06) * (r() < 0.85 ? 1 : -1);
      aSize[i] = far ? 1.2 + r() * 1.4 : 0.8 + Math.pow(r(), 3) * 2.6;
      aSeed[i] = r();
      aCyan[i] = r() < 0.16 ? 1 : 0;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    const set = (name: string, a: Float32Array) => g.setAttribute(name, new THREE.BufferAttribute(a, 1));
    set('aRadius', aRadius);
    set('aTheta', aTheta);
    set('aPhi', aPhi);
    set('aSpeed', aSpeed);
    set('aSize', aSize);
    set('aSeed', aSeed);
    set('aCyan', aCyan);
    this.uniforms = {
      uTime: { value: 0 },
      uContract: { value: 0 },
      uSpread: { value: 1 },
      uPulseR: { value: 0 },
      uPulseAmp: { value: 0 },
      uPR: { value: pixelRatio },
      uOpacity: { value: 1 },
    };
    const m = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
  }
}

interface Shard {
  r: number;
  y: number;
  a: number;
  speed: number;
  axis: THREE.Vector3;
  spin: number;
  scale: number;
  bob: number;
}

/** Machined fragments in orbit: thin plates and small chrome octahedra. */
export class Fragments {
  group = new THREE.Group();
  private sets: { mesh: THREE.InstancedMesh; shards: Shard[] }[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();

  constructor(mats: MaterialSet, count: number) {
    const r = rng(42);
    const make = (geo: THREE.BufferGeometry, mat: THREE.Material, n: number, sizeMin: number, sizeMax: number) => {
      const mesh = new THREE.InstancedMesh(geo, mat, n);
      const shards: Shard[] = [];
      for (let i = 0; i < n; i++) {
        shards.push({
          r: 2.55 + Math.pow(r(), 1.3) * 1.9,
          y: (r() * 2 - 1) * 1.5,
          a: r() * TAU,
          speed: (0.03 + r() * 0.07) * (r() < 0.8 ? 1 : -1),
          axis: new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(),
          spin: 0.1 + r() * 0.5,
          scale: sizeMin + r() * (sizeMax - sizeMin),
          bob: r() * TAU,
        });
      }
      this.group.add(mesh);
      this.sets.push({ mesh, shards });
    };
    const plate = new THREE.BoxGeometry(0.24, 0.012, 0.13);
    const rod = new THREE.BoxGeometry(0.34, 0.014, 0.014);
    const octa = new THREE.OctahedronGeometry(0.055, 0);
    make(plate, mats.graphite, Math.round(count * 0.4), 0.6, 1.4);
    make(rod, mats.chrome, Math.round(count * 0.25), 0.5, 1.2);
    make(octa, mats.chrome, Math.round(count * 0.35), 0.5, 1.3);
  }

  update(t: number, spread: number, visible: number) {
    this.group.visible = visible > 0.01;
    if (!this.group.visible) return;
    for (const { mesh, shards } of this.sets) {
      shards.forEach((sh, i) => {
        const a = sh.a + t * sh.speed;
        const r = sh.r * spread;
        this.p.set(Math.cos(a) * r, sh.y * (0.8 + spread * 0.2) + Math.sin(t * 0.4 + sh.bob) * 0.06, Math.sin(a) * r);
        this.q.setFromAxisAngle(sh.axis, t * sh.spin + sh.bob);
        this.s.setScalar(sh.scale * visible);
        this.m.compose(this.p, this.q, this.s);
        mesh.setMatrixAt(i, this.m);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
