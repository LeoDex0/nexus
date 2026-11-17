import * as THREE from 'three';
import { clamp, damp, lerp, rng, TAU } from '../util/math';

/**
 * Intelligence: a spatial network of four shells. Signals enter on the
 * outer sensing shell, are routed inward through two model shells to a
 * decision core and sent back out. Every traversal strengthens the edge it
 * used; unused edges fade, so routes form out of traffic.
 */

const CATEGORIES = ['Grid frequency', 'Rail telemetry', 'Weather radar', 'Port manifests', 'Satellite thermal'];
const RADII = [3.0, 2.05, 1.35, 0.55, 0];
const FLAT = [0.62, 0.66, 0.72, 1, 1];
const SIZES = [5.5, 7, 8, 10, 15];

interface Node {
  p: THREE.Vector3;
  layer: number;
  cat: number;
  fire: number;
  inward: number[];
  outward: number[];
}
interface Edge {
  a: number; // outer end
  b: number; // inner end
  c: THREE.Vector3; // bezier control point
  w: number;
  flash: number;
  lateral: boolean;
}
interface Signal {
  e: number;
  t: number;
  out: boolean;
  speed: number;
  depth: number;
}

const STAGES = [
  { dist: 9.6, elev: 0.3, on: [1, 0.3, 0.3, 0.25, 0.25], adapt: 0, depth: 1, rate: 30 },
  { dist: 7.4, elev: 0.5, on: [0.4, 1, 1, 0.3, 0.3], adapt: 0, depth: 3, rate: 34 },
  { dist: 5.4, elev: 0.2, on: [0.3, 0.45, 0.6, 1, 1], adapt: 0, depth: 4, rate: 34 },
  { dist: 8.8, elev: 0.95, on: [0.85, 0.9, 0.9, 0.9, 0.9], adapt: 1, depth: 4, rate: 38 },
];

const SEG = 7; // segments per drawn edge curve

export interface NetworkStats {
  flight: number;
  reinforced: number;
  events: number;
}

export class Network {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(38, 1, 0.1, 80);
  world = new THREE.Group();
  stage = 0;
  /** 0..1 pull-back as the section arrives (continues the dive into the core) */
  enter = 1;
  stats: NetworkStats = { flight: 0, reinforced: 0, events: 0 };

  private nodes: Node[] = [];
  private edges: Edge[] = [];
  private signals: Signal[] = [];
  private nodeAct: Float32Array;
  private edgeW: Float32Array;
  private sigPos: Float32Array;
  private sigA: Float32Array;
  private sigC: Float32Array;
  private nodeGeo: THREE.BufferGeometry;
  private edgeGeo: THREE.BufferGeometry;
  private sigGeo: THREE.BufferGeometry;
  private nodeMat: THREE.ShaderMaterial;
  private edgeMat: THREE.ShaderMaterial;
  private layerOn = [1, 0.3, 0.3, 0.25, 0.25];
  private adapt = 0;
  private dist = 9.6;
  private elev = 0.3;
  private yaw = 0.6;
  private px = 0;
  private py = 0;
  private spawnAcc = 0;
  private hoverNode = -1;
  private time = 0;
  private w = 1;
  private h = 1;
  private shiftX = 0;
  private maxSignals: number;
  private tags: { el: HTMLElement; p: THREE.Vector3; layer?: number }[] = [];
  private tip: HTMLElement;
  private v = new THREE.Vector3();
  private camRight = new THREE.Vector3();
  private camUp = new THREE.Vector3();
  private center: number;

  constructor(
    canvas: HTMLCanvasElement,
    labels: HTMLElement,
    private opts: { lite: boolean; reduced: boolean },
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, opts.lite ? 1.5 : 1.75));
    this.scene.add(this.world);
    this.maxSignals = opts.lite ? 260 : 520;

    /* ---- nodes ----------------------------------------------------------- */
    const counts = opts.lite ? [200, 84, 42, 10, 1] : [380, 150, 72, 14, 1];
    const r = rng(2035);
    counts.forEach((n, layer) => {
      const R = RADII[layer];
      const g = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < n; i++) {
        let p: THREE.Vector3;
        if (n === 1) p = new THREE.Vector3();
        else {
          const y = 1 - ((i + 0.5) / n) * 2;
          const rr = Math.sqrt(1 - y * y);
          const th = g * i + layer * 0.7;
          const jitter = 1 + (r() - 0.5) * 0.06;
          p = new THREE.Vector3(Math.cos(th) * rr * R * jitter, y * R * FLAT[layer] * jitter, Math.sin(th) * rr * R * jitter);
        }
        const ang = Math.atan2(p.z, p.x) + Math.PI;
        this.nodes.push({ p, layer, cat: Math.floor((ang / TAU) * 5) % 5, fire: 0, inward: [], outward: [] });
      }
    });
    this.center = this.nodes.length - 1;

    /* ---- edges: each node to its nearest neighbours one shell inward ------- */
    const byLayer = (l: number) => this.nodes.map((_, i) => i).filter((i) => this.nodes[i].layer === l);
    const dirs = this.nodes.map((n) => n.p.clone().normalize());
    const addEdge = (a: number, b: number, lateral = false) => {
      const pa = this.nodes[a].p;
      const pb = this.nodes[b].p;
      // control point: midway, pushed outward and swept a little around Y
      const mid = pa.clone().add(pb).multiplyScalar(0.5);
      const len = mid.length();
      const c = mid.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), lateral ? 0 : 0.16);
      if (len > 0.001) c.multiplyScalar(lateral ? 1.06 : 1.08);
      const e: Edge = { a, b, c, w: 0.1 + r() * 0.2, flash: 0, lateral };
      if (!lateral) {
        this.nodes[a].inward.push(this.edges.length);
        this.nodes[b].outward.push(this.edges.length);
      }
      this.edges.push(e);
    };
    for (let l = 0; l < 4; l++) {
      const inner = byLayer(l + 1);
      for (const a of byLayer(l)) {
        if (inner.length === 1) {
          addEdge(a, inner[0]);
          continue;
        }
        const ranked = inner.map((b) => ({ b, d: dirs[a].dot(dirs[b]) })).sort((x, y) => y.d - x.d);
        addEdge(a, ranked[0].b);
        if (l < 3 && r() < 0.8) addEdge(a, ranked[1].b);
      }
    }
    // lateral structure inside the model shells
    for (const l of [1, 2]) {
      const list = byLayer(l);
      for (const a of list) {
        const nb = list.filter((b) => b !== a).map((b) => ({ b, d: dirs[a].dot(dirs[b]) })).sort((x, y) => y.d - x.d)[0];
        if (nb && a < nb.b) addEdge(a, nb.b, true);
      }
    }

    /* ---- geometry: nodes ---------------------------------------------------- */
    const nN = this.nodes.length;
    const nPos = new Float32Array(nN * 3);
    const nSize = new Float32Array(nN);
    const nLayer = new Float32Array(nN);
    this.nodeAct = new Float32Array(nN);
    this.nodes.forEach((n, i) => {
      n.p.toArray(nPos, i * 3);
      nSize[i] = SIZES[n.layer] * (0.8 + r() * 0.4);
      nLayer[i] = n.layer;
    });
    this.nodeGeo = new THREE.BufferGeometry();
    this.nodeGeo.setAttribute('position', new THREE.BufferAttribute(nPos, 3));
    this.nodeGeo.setAttribute('aSize', new THREE.BufferAttribute(nSize, 1));
    this.nodeGeo.setAttribute('aLayer', new THREE.BufferAttribute(nLayer, 1));
    this.nodeGeo.setAttribute('aAct', new THREE.BufferAttribute(this.nodeAct, 1));
    const pr = this.renderer.getPixelRatio();
    this.nodeMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      premultipliedAlpha: true,
      uniforms: { uLayerOn: { value: this.layerOn }, uPR: { value: pr } },
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aLayer;
        attribute float aAct;
        uniform float uLayerOn[5];
        uniform float uPR;
        varying float vA;
        varying float vAct;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float on = uLayerOn[int(aLayer + 0.5)];
          float depth = smoothstep(15.0, 3.0, -mv.z);
          vA = (0.18 + 0.82 * on) * (0.3 + 0.7 * depth);
          vAct = aAct;
          gl_PointSize = min(aSize * uPR * (0.75 + 0.25 * on + aAct * 0.9) * (9.0 / -mv.z), 15.0 * uPR);
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        varying float vAct;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float core = smoothstep(0.5, 0.32, d);
          float ring = smoothstep(0.5, 0.42, d) - smoothstep(0.38, 0.3, d);
          vec3 col = mix(vec3(0.82, 0.88, 0.93), vec3(0.36, 0.92, 1.0), clamp(vAct * 1.4, 0.0, 1.0));
          float a = (core * (0.55 + 0.45 * vAct) + ring * 0.25 * vAct) * vA;
          gl_FragColor = vec4(col * a, a);
        }`,
    });
    this.world.add(new THREE.Points(this.nodeGeo, this.nodeMat));

    /* ---- geometry: edge curves --------------------------------------------- */
    const nE = this.edges.length;
    const ePos = new Float32Array(nE * SEG * 2 * 3);
    const eLayer = new Float32Array(nE * SEG * 2);
    this.edgeW = new Float32Array(nE * SEG * 2);
    const tmpA = new THREE.Vector3();
    const tmpB = new THREE.Vector3();
    this.edges.forEach((e, k) => {
      const layer = Math.min(this.nodes[e.a].layer, this.nodes[e.b].layer);
      for (let s = 0; s < SEG; s++) {
        this.bezier(e, s / SEG, tmpA);
        this.bezier(e, (s + 1) / SEG, tmpB);
        const o = (k * SEG + s) * 2;
        tmpA.toArray(ePos, o * 3);
        tmpB.toArray(ePos, (o + 1) * 3);
        eLayer[o] = eLayer[o + 1] = layer;
      }
    });
    this.edgeGeo = new THREE.BufferGeometry();
    this.edgeGeo.setAttribute('position', new THREE.BufferAttribute(ePos, 3));
    this.edgeGeo.setAttribute('aLayer', new THREE.BufferAttribute(eLayer, 1));
    this.edgeGeo.setAttribute('aW', new THREE.BufferAttribute(this.edgeW, 1));
    this.edgeMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      premultipliedAlpha: true,
      uniforms: { uLayerOn: { value: this.layerOn }, uAdapt: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute float aW;
        attribute float aLayer;
        uniform float uLayerOn[5];
        uniform float uAdapt;
        varying float vA;
        varying float vCy;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float on = uLayerOn[int(aLayer + 0.5)];
          float depth = smoothstep(15.0, 3.0, -mv.z);
          vA = (0.035 + aW * aW * 0.95) * (0.3 + 0.7 * on) * (0.4 + 0.6 * depth);
          vCy = uAdapt * smoothstep(0.3, 0.75, aW);
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        varying float vCy;
        void main() {
          vec3 col = mix(vec3(0.84, 0.9, 0.95), vec3(0.33, 0.9, 1.0), vCy);
          gl_FragColor = vec4(col * vA, vA);
        }`,
    });
    const lines = new THREE.LineSegments(this.edgeGeo, this.edgeMat);
    lines.frustumCulled = false;
    this.world.add(lines);

    /* ---- signals (head + two trail samples each) ---------------------------- */
    const nS = this.maxSignals * 3;
    this.sigPos = new Float32Array(nS * 3);
    this.sigA = new Float32Array(nS);
    this.sigC = new Float32Array(nS);
    this.sigGeo = new THREE.BufferGeometry();
    this.sigGeo.setAttribute('position', new THREE.BufferAttribute(this.sigPos, 3));
    this.sigGeo.setAttribute('aA', new THREE.BufferAttribute(this.sigA, 1));
    this.sigGeo.setAttribute('aC', new THREE.BufferAttribute(this.sigC, 1));
    const sigs = new THREE.Points(
      this.sigGeo,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        premultipliedAlpha: true,
        uniforms: { uPR: { value: pr } },
        vertexShader: /* glsl */ `
          attribute float aA;
          attribute float aC;
          uniform float uPR;
          varying float vA;
          varying float vC;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mv;
            vA = aA;
            vC = aC;
            gl_PointSize = min((2.0 + aA * 5.0) * uPR * (8.0 / -mv.z), 9.0 * uPR);
          }`,
        fragmentShader: /* glsl */ `
          varying float vA;
          varying float vC;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            float a = smoothstep(0.5, 0.0, d) * vA;
            vec3 col = mix(vec3(1.0), vec3(0.35, 0.92, 1.0), vC);
            gl_FragColor = vec4(col * a, a);
          }`,
      }),
    );
    sigs.frustumCulled = false;
    this.world.add(sigs);

    /* ---- shell guides ------------------------------------------------------- */
    const guideMat = new THREE.LineBasicMaterial({ color: '#cfdbe4', transparent: true, opacity: 0.07, depthWrite: false });
    for (let l = 0; l < 3; l++) {
      for (const lat of [-0.5, 0, 0.5]) {
        const pts: THREE.Vector3[] = [];
        const R = RADII[l];
        const yy = Math.sin(lat) * R * FLAT[l];
        const rr = Math.cos(lat) * R;
        for (let k = 0; k <= 128; k++) {
          const a = (k / 128) * TAU;
          pts.push(new THREE.Vector3(Math.cos(a) * rr, yy, Math.sin(a) * rr));
        }
        this.world.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), guideMat));
      }
    }
    // a hairline meridian ring that marks the active shell
    const decideRing = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.004, 6, 128), new THREE.MeshBasicMaterial({ color: '#5fe9ff', transparent: true, opacity: 0.5 }));
    decideRing.rotation.x = Math.PI / 2;
    decideRing.name = 'decideRing';
    this.world.add(decideRing);

    /* ---- labels --------------------------------------------------------------- */
    const layerNames = ['Sense', 'Model', 'Decide'];
    const layerCounts = [counts[0], counts[1] + counts[2], counts[3]];
    layerNames.forEach((name, i) => {
      const el = document.createElement('div');
      el.className = 'intel__tag is-layer';
      el.innerHTML = `${name} <b>${layerCounts[i]}</b>`;
      labels.appendChild(el);
      this.tags.push({ el, p: new THREE.Vector3(), layer: i === 0 ? 0 : i === 1 ? 1 : 3 });
    });
    if (!opts.lite) {
      CATEGORIES.forEach((name, c) => {
        const el = document.createElement('div');
        el.className = 'intel__tag';
        el.textContent = name;
        labels.appendChild(el);
        const a = ((c + 0.5) / 5) * TAU - Math.PI;
        this.tags.push({ el, p: new THREE.Vector3(Math.cos(a) * 3.35, 0, Math.sin(a) * 3.35) });
      });
    }
    this.tip = document.createElement('div');
    this.tip.className = 'intel__tip';
    labels.appendChild(this.tip);

    // a little history so routes already exist when the section appears
    for (let i = 0; i < 420; i++) this.simulate(1 / 30, true);
    this.signals.length = 0;
    this.stats.reinforced = 0;
  }

  private bezier(e: Edge, t: number, out: THREE.Vector3) {
    const pa = this.nodes[e.a].p;
    const pb = this.nodes[e.b].p;
    const u = 1 - t;
    out.set(
      u * u * pa.x + 2 * u * t * e.c.x + t * t * pb.x,
      u * u * pa.y + 2 * u * t * e.c.y + t * t * pb.y,
      u * u * pa.z + 2 * u * t * e.c.z + t * t * pb.z,
    );
    return out;
  }

  private choose(list: number[]) {
    if (!list.length) return -1;
    let sum = 0;
    for (const e of list) sum += this.edges[e].w * this.edges[e].w + 0.003;
    let x = Math.random() * sum;
    for (const e of list) {
      x -= this.edges[e].w * this.edges[e].w + 0.003;
      if (x <= 0) return e;
    }
    return list[list.length - 1];
  }

  private spawnIn(node: number, speed = 1) {
    if (this.signals.length >= this.maxSignals) return;
    const e = this.choose(this.nodes[node].inward);
    if (e >= 0) this.signals.push({ e, t: 0, out: false, speed: (0.5 + Math.random() * 0.35) * speed, depth: 1 });
  }

  private simulate(dt: number, warm = false) {
    const st = STAGES[this.stage];
    const plasticity = warm ? 0.3 : this.stage === 3 ? 1 : this.stage === 2 ? 0.35 : 0.15;
    const maxDepth = warm ? 4 : st.depth;
    const senseCount = this.nodes.filter((n) => n.layer === 0).length;
    this.spawnAcc += dt * (this.opts.reduced ? 6 : st.rate);
    while (this.spawnAcc > 1) {
      this.spawnAcc--;
      this.spawnIn(Math.floor(Math.random() * senseCount));
    }
    for (let i = this.signals.length - 1; i >= 0; i--) {
      const s = this.signals[i];
      s.t += dt * s.speed * (s.out ? 1.2 : 1);
      if (s.t < 1) continue;
      const e = this.edges[s.e];
      e.flash = 1;
      if (!s.out) {
        e.w += 0.05 * plasticity * (1 - e.w);
        this.stats.reinforced++;
        const at = this.nodes[e.b];
        at.fire = 1;
        if (e.b === this.center) {
          const k = this.choose(at.outward);
          if (k >= 0 && (warm || this.stage >= 2)) {
            this.signals[i] = { e: k, t: 0, out: true, speed: 0.85 + Math.random() * 0.4, depth: 0 };
            if (Math.random() < 0.6) {
              const k2 = this.choose(at.outward);
              if (k2 >= 0 && this.signals.length < this.maxSignals) this.signals.push({ e: k2, t: 0, out: true, speed: 0.85 + Math.random() * 0.4, depth: 0 });
            }
            continue;
          }
          this.signals.splice(i, 1);
          continue;
        }
        if (s.depth >= maxDepth) {
          this.signals.splice(i, 1);
          continue;
        }
        const next = this.choose(at.inward);
        if (next < 0) this.signals.splice(i, 1);
        else {
          s.e = next;
          s.t = 0;
          s.depth++;
        }
      } else {
        const at = this.nodes[e.a];
        at.fire = 1;
        e.w += 0.03 * plasticity * (1 - e.w);
        if (at.layer === 0) {
          this.signals.splice(i, 1);
          continue;
        }
        const next = this.choose(at.outward);
        if (next < 0) this.signals.splice(i, 1);
        else {
          s.e = next;
          s.t = 0;
        }
      }
    }
    const decay = 1 - dt * 0.02 * (0.3 + plasticity);
    for (const e of this.edges) {
      if (!e.lateral) e.w = 0.06 + (e.w - 0.06) * decay;
      e.flash = Math.max(0, e.flash - dt * 2.4);
    }
    for (const n of this.nodes) n.fire = Math.max(0, n.fire - dt * 2.2);
  }

  setStage(i: number) {
    this.stage = clamp(Math.round(i), 0, 3);
  }

  setPointer(nx: number, ny: number) {
    this.px = nx;
    this.py = ny;
  }

  /** Screen-space nearest sensing node within `radius` px, or -1. */
  private nearestSense(x: number, y: number, radius: number) {
    let best = -1;
    let bd = radius * radius;
    for (let i = 0; i < this.nodes.length; i++) {
      if (this.nodes[i].layer !== 0) continue;
      this.v.copy(this.nodes[i].p).applyMatrix4(this.world.matrixWorld).project(this.camera);
      if (this.v.z > 1) continue;
      const sx = (this.v.x * 0.5 + 0.5) * this.w;
      const sy = (-this.v.y * 0.5 + 0.5) * this.h;
      const d = (sx - x) ** 2 + (sy - y) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  hover(x: number, y: number) {
    this.hoverNode = x < 0 ? -1 : this.nearestSense(x, y, 26);
    if (this.hoverNode < 0) {
      this.tip.classList.remove('is-on');
      return;
    }
    const n = this.nodes[this.hoverNode];
    this.tip.innerHTML = `Sensor ${String(this.hoverNode).padStart(4, '0')}<span>${CATEGORIES[n.cat]}</span>`;
    this.tip.style.transform = `translate3d(${Math.min(x + 16, this.w - 190)}px, ${y + 14}px, 0)`;
    this.tip.classList.add('is-on');
  }

  /** Injects an event at the sensing node nearest a screen point. */
  inject(x: number, y: number) {
    const hit = this.nearestSense(x, y, 90);
    const origin = hit >= 0 ? this.nodes[hit].p : null;
    this.stats.events++;
    // the burst covers the closest few sensors to the click
    const list = this.nodes
      .map((n, i) => ({ i, d: n.layer === 0 && origin ? n.p.distanceToSquared(origin) : Infinity }))
      .filter((o) => o.d < Infinity)
      .sort((a, b) => a.d - b.d)
      .slice(0, 9);
    if (!list.length) {
      const sense = this.nodes.map((n, i) => (n.layer === 0 ? i : -1)).filter((i) => i >= 0);
      for (let k = 0; k < 9; k++) list.push({ i: sense[Math.floor(Math.random() * sense.length)], d: 0 });
    }
    for (const { i } of list) {
      this.nodes[i].fire = 1;
      this.spawnIn(i, 1.6);
      this.spawnIn(i, 1.35);
    }
  }

  resize(w: number, h: number, shiftX: number) {
    this.w = w;
    this.h = h;
    this.shiftX = shiftX;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  frame(dt: number) {
    this.time += dt;
    const t = this.time;
    const st = STAGES[this.stage];
    this.simulate(dt);

    // stage presets ease in
    for (let l = 0; l < 5; l++) this.layerOn[l] = damp(this.layerOn[l], st.on[l], 3, dt);
    this.adapt = damp(this.adapt, st.adapt, 2.5, dt);
    this.dist = damp(this.dist, st.dist, 2, dt);
    this.elev = damp(this.elev, st.elev, 2, dt);
    this.edgeMat.uniforms.uAdapt.value = this.adapt;

    const reduced = this.opts.reduced;
    this.yaw += dt * (reduced ? 0.005 : 0.04);
    const enter = this.enter * this.enter * (3 - 2 * this.enter);
    // narrow fields need more distance for the shells to fit across
    const fit = Math.max(1, 1.05 / Math.max(0.5, this.w / this.h));
    const dist = this.dist * fit * lerp(0.14, 1, enter);
    const yaw = this.yaw + this.px * 0.25;
    const elev = this.elev + this.py * 0.12;
    this.camera.position.set(Math.cos(yaw) * Math.cos(elev) * dist, Math.sin(elev) * dist, Math.sin(yaw) * Math.cos(elev) * dist);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    this.camera.projectionMatrix.elements[8] = -this.shiftX * 2 * enter;
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
    this.camera.updateMatrixWorld();
    this.world.updateMatrixWorld();

    // node activity
    for (let i = 0; i < this.nodes.length; i++) {
      this.nodeAct[i] = Math.min(1, this.nodes[i].fire + (i === this.hoverNode ? 1 : 0) + (i === this.center ? 0.6 + 0.4 * Math.sin(t * 3) : 0));
    }
    this.nodeGeo.getAttribute('aAct').needsUpdate = true;

    // edge weights per vertex
    const per = SEG * 2;
    for (let k = 0; k < this.edges.length; k++) {
      const e = this.edges[k];
      const val = Math.min(1, (e.lateral ? 0.12 : e.w * 0.9) + e.flash * 0.35);
      this.edgeW.fill(val, k * per, k * per + per);
    }
    this.edgeGeo.getAttribute('aW').needsUpdate = true;

    // signals
    const p = this.v;
    let j = 0;
    for (const s of this.signals) {
      const e = this.edges[s.e];
      const tt = s.out ? 1 - s.t : s.t;
      const dir = s.out ? 1 : -1;
      for (let k = 0; k < 3; k++) {
        this.bezier(e, clamp(tt + dir * k * 0.045), p);
        p.toArray(this.sigPos, j * 3);
        this.sigA[j] = k === 0 ? 1 : k === 1 ? 0.45 : 0.18;
        this.sigC[j] = s.out ? 1 : 0;
        j++;
      }
    }
    for (; j < this.maxSignals * 3; j++) this.sigA[j] = 0;
    this.sigGeo.getAttribute('position').needsUpdate = true;
    this.sigGeo.getAttribute('aA').needsUpdate = true;
    this.sigGeo.getAttribute('aC').needsUpdate = true;
    this.sigGeo.setDrawRange(0, this.signals.length * 3);

    const ring = this.world.getObjectByName('decideRing') as THREE.Mesh;
    ring.rotation.z = t * 0.4;
    ring.scale.setScalar(1 + this.nodes[this.center].fire * 0.15);
    (ring.material as THREE.MeshBasicMaterial).opacity = 0.15 + this.layerOn[3] * 0.45;

    this.renderer.render(this.scene, this.camera);
    this.placeLabels();
    this.stats.flight = this.signals.length;
  }

  private placeLabels() {
    this.camRight.setFromMatrixColumn(this.camera.matrixWorld, 0).normalize();
    this.camUp.setFromMatrixColumn(this.camera.matrixWorld, 1).normalize();
    const angles = [0.62, 0.42, 0.18];
    for (const tag of this.tags) {
      let p: THREE.Vector3;
      let alpha = 1;
      if (tag.layer !== undefined) {
        // pinned to the upper-right edge of its shell as seen from the camera
        const R = RADII[tag.layer] * (tag.layer === 3 ? 1.35 : 1);
        const a = angles[tag.layer === 0 ? 0 : tag.layer === 1 ? 1 : 2];
        p = this.v
          .set(0, 0, 0)
          .addScaledVector(this.camRight, Math.cos(a) * R * 1.02)
          .addScaledVector(this.camUp, Math.sin(a) * R * (tag.layer < 3 ? FLAT[tag.layer] + 0.12 : 1));
        alpha = 0.45 + 0.55 * this.layerOn[tag.layer];
      } else {
        p = this.v.copy(tag.p).applyMatrix4(this.world.matrixWorld);
        // categories fade on the far side of the shell
        const toCam = this.camera.position.clone().sub(p).normalize();
        alpha = clamp(p.clone().normalize().dot(toCam) * 2 + 0.2) * (0.35 + 0.65 * this.layerOn[0]);
      }
      p.project(this.camera);
      const x = (p.x * 0.5 + 0.5) * this.w;
      const y = (-p.y * 0.5 + 0.5) * this.h;
      const cx = Math.min(x, this.w - tag.el.offsetWidth - 6);
      tag.el.style.transform = `translate3d(${cx.toFixed(1)}px, ${(y - 7).toFixed(1)}px, 0)`;
      tag.el.style.opacity = (alpha * this.enter).toFixed(3);
    }
  }

  dispose() {
    this.renderer.dispose();
  }
}
