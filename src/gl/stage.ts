import * as THREE from 'three';
import { studioEnvironment } from './environment';
import { createMaterials } from './materials';
import { LAYER_Y, Structure, type StructureState } from './structure';
import { Fragments, Particles } from './particles';
import { floorGrid, lightShaft } from './atmosphere';
import type { Profile } from '../core/env';
import { pointer } from '../core/env';
import { clamp, damp, lerp, smoothstep } from '../util/math';

export interface View {
  cam: THREE.Vector3Tuple;
  target: THREE.Vector3Tuple;
  fov: number;
  shiftX: number;
  shiftY: number;
  scale: number;
  display: number;
  explode: number;
  cta: number;
  particles: number;
  spread: number;
  fragments: number;
  env: number;
  shaft: number;
  floor: number;
}

export type Mode = 'hero' | 'arch' | 'cta';

function wrapAngle(a: number) {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

const KEYS: (keyof View)[] = ['fov', 'shiftX', 'shiftY', 'scale', 'display', 'explode', 'cta', 'particles', 'spread', 'fragments', 'env', 'shaft', 'floor'];

function poses(aspect: number): Record<'hero' | 'core' | 'arch' | 'cta', View> {
  const portrait = aspect < 0.85;
  // squarer landscape screens (tablets, 4:3 and 5:4 monitors)
  const tablet = !portrait && aspect < 1.5;
  const squarish = tablet && aspect < 1.2;
  const base = { scale: 1, display: 0, explode: 0, cta: 0, particles: 1, spread: 1, fragments: 1, env: 1, shaft: 1, floor: 1 };
  if (portrait) {
    // portrait tablets have room for a larger stack than phones
    const k = aspect > 0.62 ? 0.8 : 1;
    return {
      hero: { ...base, cam: [0, 0.3, 17.5], target: [0, 0, 0], fov: 33, shiftX: 0, shiftY: 0.2 },
      core: { ...base, cam: [1.4, 1.6, 17.5], target: [0, 0, 0], fov: 33, shiftX: 0, shiftY: 0.2, display: 1, spread: 1.2 },
      arch: { ...base, cam: [12.1 * k, 9.0 * k, 15.4 * k], target: [0, 0.2, 0], fov: 33, shiftX: 0, shiftY: 0.21, explode: 1, particles: 0.3, fragments: 0, spread: 1.4, shaft: 0.5 },
      cta: { ...base, cam: [0, 0, 12], target: [0, 0, 0], fov: 40, shiftX: 0, shiftY: 0, cta: 1, env: 0.8, spread: 1.2, shaft: 0.6, floor: 0 },
    };
  }
  return {
    hero: { ...base, cam: [0, 0.25, tablet ? 12 : 10.9], target: [0, 0.02, 0], fov: 30, shiftX: squarish ? 0 : tablet ? 0.17 : 0.02, shiftY: tablet ? 0.07 : 0.02 },
    core: { ...base, cam: [1.6, 1.7, tablet ? 11.5 : 9.1], target: [0, -0.1, 0], fov: 30, shiftX: 0, shiftY: tablet ? 0.03 : -0.02, display: 1, spread: 1.3 },
    arch: { ...base, cam: [8.3, 6.0, 10.4], target: [0, 0.15, 0], fov: tablet ? 30 : 26, shiftX: tablet ? 0.12 : 0.1, shiftY: -0.02, explode: 1, particles: 0.3, fragments: 0, spread: 1.4, shaft: 0.5 },
    cta: { ...base, cam: [0, 0, tablet ? 7.8 : 6.4], target: [0, 0, 0], fov: 44, shiftX: 0, shiftY: 0.0, cta: 1, env: 0.8, spread: 1.25, shaft: 0.6, floor: 0 },
  };
}

/**
 * The canvas is transparent so the page shows through, but three.js clears
 * the transmission buffer to half-transparent white in that case, which
 * turns glass milky grey. This sphere is drawn only into that buffer, so
 * glass refracts the dark page colour instead.
 */
function transmissionBackdrop() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uOn: { value: 0 } },
    vertexShader: 'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform float uOn; void main(){ if (uOn < 0.5) discard; gl_FragColor = vec4(0.0019, 0.0022, 0.0026, 1.0); }',
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(45, 24, 12), mat);
  m.renderOrder = -10;
  m.frustumCulled = false;
  m.onBeforeRender = (r) => {
    mat.uniforms.uOn.value = r.getRenderTarget() !== null ? 1 : 0;
  };
  return m;
}

function mix(a: View, b: View, t: number): View {
  const o = { ...a } as View;
  for (const k of KEYS) (o[k] as number) = lerp(a[k] as number, b[k] as number, t);
  o.cam = [lerp(a.cam[0], b.cam[0], t), lerp(a.cam[1], b.cam[1], t), lerp(a.cam[2], b.cam[2], t)];
  o.target = [lerp(a.target[0], b.target[0], t), lerp(a.target[1], b.target[1], t), lerp(a.target[2], b.target[2], t)];
  return o;
}

export class Stage {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(30, 1, 0.05, 100);
  structure: Structure;
  particles: Particles;
  fragments: Fragments;
  /** 0..1, controlled by the story (scroll) */
  visibility = 1;
  mode: Mode = 'hero';
  heroToCore = 0;
  layer = 0;
  /** 0..1: the camera dives into the lattice at the end of the core section */
  dive = 0;
  /** intro assembly progress, animated by the intro timeline */
  intro = 0;
  holding = false;
  charge = 0;
  /** inspect mode: parts separate and are labelled */
  inspecting = false;
  inspect = 0;
  /** hovered part (PARTS index) or -1 */
  hover = -1;
  /** set by the story: pointer picking is meaningful right now */
  pickable = false;
  onResolve?: (ms: number) => void;
  onCharge?: (c: number) => void;
  onHover?: (part: number) => void;

  private view: View;
  private poses = poses(1.6);
  private dpr: number;
  private frameTimes: number[] = [];
  private lastDprChange = 0;
  private time = 0;
  private yaw = 0;
  private yawVel = 0;
  private tiltX = 0;
  private tiltY = 0;
  private pulse = 9;
  private resolved = false;
  private chargeStart = 0;
  private snapNext = true;
  private glow = 1;
  private tmp = new THREE.Vector3();
  private raycaster = new THREE.Raycaster();
  private pickFrame = 0;
  private lastPX = 9;
  private lastPY = 9;
  private shaft = lightShaft();
  private floor = floorGrid();

  constructor(
    public canvas: HTMLCanvasElement,
    private profile: Profile,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.dpr = Math.min(devicePixelRatio || 1, profile.maxDpr);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene.environment = studioEnvironment(this.renderer);
    this.scene.environmentIntensity = 0;
    this.scene.add(transmissionBackdrop());

    const transmission = profile.tier === 'high' || (profile.tier === 'mid' && !profile.mobile);
    const mats = createMaterials(transmission);
    const segments = profile.tier === 'low' ? 128 : profile.mobile ? 180 : 256;
    this.structure = new Structure(mats, { segments, pixelRatio: this.dpr, lite: profile.mobile || profile.tier === 'low' });
    this.scene.add(this.structure.root);

    this.particles = new Particles(profile.tier === 'low' ? 400 : profile.mobile ? 650 : 1300, this.dpr);
    this.structure.root.add(this.particles.points);
    this.fragments = new Fragments(mats, profile.mobile ? 18 : 34);
    this.structure.root.add(this.fragments.group);

    this.scene.add(this.shaft.mesh, this.floor.mesh);

    // large soft key, two rims, a low cool fill: the env map does most of the work
    const key = new THREE.DirectionalLight('#ffffff', 2.0);
    key.position.set(-4, 6, 5);
    const rimL = new THREE.DirectionalLight('#d6ecff', 1.6);
    rimL.position.set(-6, 1.5, -6);
    const rimR = new THREE.DirectionalLight('#cfe8ff', 1.8);
    rimR.position.set(6, 2.5, -5);
    const fill = new THREE.DirectionalLight('#9fdcff', 0.35);
    fill.position.set(0, -6, 4);
    this.scene.add(key, rimL, rimR, fill);

    this.view = { ...this.poses.hero };
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  async compile() {
    // Warm up every program once, including the hidden architecture parts.
    this.structure.plate.visible = true;
    this.structure.iface.visible = true;
    this.structure.spine.visible = true;
    try {
      await this.renderer.compileAsync(this.scene, this.camera);
    } catch {
      this.renderer.compile(this.scene, this.camera);
    }
    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    const w = innerWidth;
    const h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.poses = poses(w / h);
    this.snapNext = true;
    this.applyCamera();
  }

  private target(): View {
    if (this.mode === 'arch') {
      // the camera follows the selected layer up and down the stack
      const a = this.poses.arch;
      const li = clamp(this.layer, 0, 4);
      const y = lerp(LAYER_Y[Math.floor(li)], LAYER_Y[Math.ceil(li)], li - Math.floor(li)) * 0.38;
      return { ...a, cam: [a.cam[0], a.cam[1] + y, a.cam[2]], target: [a.target[0], a.target[1] + y, a.target[2]] };
    }
    if (this.mode === 'cta') return this.poses.cta;
    return mix(this.poses.hero, this.poses.core, this.heroToCore);
  }

  setVisibility(v: number) {
    v = clamp(v);
    if (Math.abs(v - this.visibility) > 0.001) {
      this.visibility = v;
      this.canvas.style.opacity = String(v);
      this.canvas.style.visibility = v < 0.005 ? 'hidden' : 'visible';
    }
  }

  setMode(m: Mode) {
    if (m !== this.mode) {
      this.mode = m;
      if (this.visibility < 0.08) this.snapNext = true;
      if (m !== 'hero') this.inspecting = false;
    }
  }

  drag(dx: number) {
    this.yawVel += dx * 9;
    this.structure.impulse(dx * 2.5);
  }

  toggleInspect(on = !this.inspecting) {
    this.inspecting = on;
    if (on) this.structure.triggerBeat(0.8);
  }

  /** Part under a point in normalised device coordinates, or -1. */
  pick(ndcX: number, ndcY: number) {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const hits = this.raycaster.intersectObjects(this.structure.pickables, false);
    return hits.length ? (hits[0].object.userData.part as number) : -1;
  }

  project(v: THREE.Vector3, out: { x: number; y: number }) {
    this.tmp.copy(v).project(this.camera);
    out.x = (this.tmp.x * 0.5 + 0.5) * innerWidth;
    out.y = (-this.tmp.y * 0.5 + 0.5) * innerHeight;
    return out;
  }

  private applyCamera() {
    const v = this.view;
    this.camera.fov = v.fov;
    this.camera.position.set(...v.cam);
    this.camera.lookAt(v.target[0], v.target[1], v.target[2]);
    this.camera.updateProjectionMatrix();
    // Lens shift: moves the subject in frame without changing its perspective.
    const e = this.camera.projectionMatrix.elements;
    e[8] = -v.shiftX * 2;
    e[9] = -v.shiftY * 2;
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
    this.camera.updateMatrixWorld();
  }

  update(dt: number) {
    this.time += dt;
    const t = this.time;

    // charge / resolve -------------------------------------------------------
    if (this.holding && !this.resolved) {
      if (this.charge === 0) this.chargeStart = performance.now();
      this.charge = Math.min(1, this.charge + dt / 1.5);
      if (this.charge >= 1) {
        this.resolved = true;
        this.pulse = 0;
        this.structure.kick(Math.floor(Math.random() * 1e6));
        this.onResolve?.(performance.now() - this.chargeStart);
      }
    } else {
      this.charge = Math.max(0, this.charge - dt * (this.resolved ? 1.1 : 2.2));
      if (!this.holding && this.charge === 0) this.resolved = false;
    }
    this.onCharge?.(this.charge);
    this.pulse += dt * 5.5;
    this.inspect = damp(this.inspect, this.inspecting && this.mode === 'hero' ? 1 : 0, 4, dt);

    if (this.visibility <= 0.001) return;

    // view blending --------------------------------------------------------
    const target = this.target();
    if (this.snapNext) {
      this.view = { ...target, cam: [...target.cam], target: [...target.target] };
      this.snapNext = false;
    } else {
      const k = 1 - Math.exp(-7 * dt);
      this.view = mix(this.view, target, k);
    }
    const v = this.view;

    // camera: intro pull-back, inspect push-in, dive into the lattice
    const introEase = 1 - Math.pow(1 - this.intro, 3);
    const ins = smoothstep(0, 1, this.inspect);
    const dive = this.dive * this.dive * (3 - 2 * this.dive);
    const saved = { cam: v.cam, fov: v.fov, shiftX: v.shiftX, shiftY: v.shiftY };
    const push = 1 - ins * 0.12;
    let cx = v.target[0] + (v.cam[0] - v.target[0]) * push;
    let cy = v.target[1] + (v.cam[1] - v.target[1]) * push + (1 - introEase) * 0.8;
    let cz = v.target[2] + (v.cam[2] - v.target[2]) * push + (1 - introEase) * 6;
    if (dive > 0) {
      const d = 1.25;
      const len = Math.hypot(cx, cy, cz) || 1;
      const k = lerp(1, d / len, dive);
      cx *= k;
      cy *= k;
      cz *= k;
      v.fov = lerp(v.fov, 52, dive);
      v.shiftX *= 1 - dive;
      v.shiftY *= 1 - dive;
    }
    v.shiftX *= 1 - ins * 0.6;
    v.cam = [cx, cy, cz];
    this.applyCamera();
    v.cam = saved.cam;
    v.fov = saved.fov;
    v.shiftX = saved.shiftX;
    v.shiftY = saved.shiftY;
    this.scene.environmentIntensity = v.env * introEase;
    this.glow = damp(this.glow, introEase, 6, dt);

    // root: slow sway (never a turntable spin), pointer tilt, drag inertia
    const reduced = this.profile.reducedMotion;
    this.yawVel *= Math.exp(-2.4 * dt);
    this.yaw += this.yawVel * dt + (reduced ? 0 : 0.05 * v.cta * dt);
    if (v.display > 0.001) {
      const d = wrapAngle(0.62 - this.yaw);
      this.yaw += d * Math.min(1, dt * 2.2 * v.display);
    }
    const sway = reduced ? 0 : (0.34 * Math.sin(t * 0.075) + 0.08 * Math.sin(t * 0.19)) * (1 - v.display) * (1 - v.cta);
    this.trackPerformance(dt * 1000);
    const pointerWeight = 1 - v.explode * 0.6;
    this.tiltX = damp(this.tiltX, -pointer.y * 0.16 * pointerWeight, 3, dt);
    this.tiltY = damp(this.tiltY, pointer.x * 0.32 * pointerWeight, 3, dt);
    const root = this.structure.root;
    root.rotation.set(this.tiltX + (1 - introEase) * 0.6 + 0.05 * Math.sin(t * 0.11), this.yaw + sway + this.tiltY - (1 - introEase) * 1.4, 0);
    root.scale.setScalar(v.scale * (0.82 + 0.18 * introEase));
    if (!reduced) this.structure.impulse(clamp(pointer.vx, -4, 4) * dt * 0.05);

    // hover picking, at most every other frame and only when the pointer moved
    if (this.pickable && pointer.active && !this.profile.coarse && dive < 0.05 && ++this.pickFrame % 2 === 0) {
      if (pointer.x !== this.lastPX || pointer.y !== this.lastPY) {
        this.lastPX = pointer.x;
        this.lastPY = pointer.y;
        const h = this.pick(pointer.x, pointer.y);
        if (h !== this.hover) {
          this.hover = h;
          this.onHover?.(h);
        }
      }
    } else if (!this.pickable && this.hover !== -1) {
      this.hover = -1;
      this.onHover?.(-1);
    }

    const s: StructureState = {
      display: v.display,
      cta: v.cta,
      explode: v.explode,
      layer: this.layer,
      charge: this.charge,
      glow: this.glow,
      inspect: this.inspect,
      hover: this.hover,
      calibrate: this.mode === 'hero' && !this.holding && !reduced,
      lite: this.profile.mobile,
    };
    this.structure.update(reduced ? dt * 0.35 : dt, s);

    const u = this.particles.uniforms;
    u.uTime.value = t;
    u.uContract.value = this.charge * this.charge;
    u.uSpread.value = v.spread;
    u.uOpacity.value = v.particles * introEase * (1 - dive * 0.7);
    u.uPulseR.value = this.pulse;
    u.uPulseAmp.value = Math.max(0, 1 - this.pulse / 8);
    this.fragments.update(t, v.spread * (1 - this.charge * 0.25) * (1 + ins * 0.25), v.fragments * introEase * (1 - dive));

    this.shaft.uniforms.uTime.value = t;
    this.shaft.uniforms.uOpacity.value = 0.075 * v.shaft * introEase * (1 - dive);
    this.floor.uniforms.uTime.value = t;
    this.floor.uniforms.uOpacity.value = 0.3 * v.floor * introEase * (1 - dive);
  }

  render() {
    if (this.visibility <= 0.001) return;
    this.renderer.render(this.scene, this.camera);
  }

  /** Lowers the pixel ratio if frames keep running long. */
  private trackPerformance(ms: number) {
    this.frameTimes.push(ms);
    if (this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    const now = performance.now();
    if (document.hidden) return;
    if (avg > 24 && this.dpr > 1 && now - this.lastDprChange > 2500) {
      this.dpr = Math.max(1, this.dpr - 0.25);
      this.renderer.setPixelRatio(this.dpr);
      this.resize();
      this.lastDprChange = now;
    }
  }
}
