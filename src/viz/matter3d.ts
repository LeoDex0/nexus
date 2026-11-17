import * as THREE from 'three';
import { gsap } from 'gsap';
import { studioEnvironment } from '../gl/environment';
import { buildStructures, N } from './matter';
import { clamp, damp, easeInOut, rng } from '../util/math';

/**
 * NEXUS Matter in 3D: a crystal specimen of polished chrome, translucent
 * glass and titanium atoms that relaxes from one candidate structure into
 * the next. Bonds of the old structure retract while the new ones extend.
 * Renders only while visible; drag to turn it.
 */
export function matter3d(canvas: HTMLCanvasElement, table: HTMLElement | null, reduced: boolean) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.environment = studioEnvironment(renderer);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 0, 6.2);
  const key = new THREE.DirectionalLight('#ffffff', 2.2);
  key.position.set(-3, 4, 5);
  const rim = new THREE.DirectionalLight('#cfe8ff', 1.6);
  rim.position.set(4, 1, -4);
  scene.add(key, rim);

  const specimen = new THREE.Group();
  scene.add(specimen);

  const structs = buildStructures();
  const mats = [
    new THREE.MeshPhysicalMaterial({ color: '#e3e7ec', metalness: 1, roughness: 0.08, envMapIntensity: 1.4 }),
    new THREE.MeshPhysicalMaterial({
      color: '#bff3ff',
      metalness: 0,
      roughness: 0.12,
      transparent: true,
      opacity: 0.82,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      emissive: new THREE.Color('#0e5563'),
      emissiveIntensity: 0.6,
      envMapIntensity: 1.6,
    }),
    new THREE.MeshPhysicalMaterial({ color: '#b5b2ac', metalness: 1, roughness: 0.32, envMapIntensity: 1.3 }),
  ];
  const radii = [0.17, 0.12, 0.085];
  const sphere = new THREE.SphereGeometry(1, 28, 20);
  const atomMeshes = mats.map((m) => {
    const mesh = new THREE.InstancedMesh(sphere, m, N);
    mesh.count = 0;
    specimen.add(mesh);
    return mesh;
  });
  const maxBonds = Math.max(...structs.map((s) => s.bonds.length));
  const bondMat = new THREE.MeshPhysicalMaterial({ color: '#9aa4ad', metalness: 1, roughness: 0.25, envMapIntensity: 1.1 });
  const bondGeo = new THREE.CylinderGeometry(1, 1, 1, 10);
  const bondsA = new THREE.InstancedMesh(bondGeo, bondMat, maxBonds);
  const bondsB = new THREE.InstancedMesh(bondGeo, bondMat, maxBonds);
  specimen.add(bondsA, bondsB);

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
  let visible = false;
  let w = 1;
  let h = 1;
  let runId = 4700;
  const r = rng(77);
  const pos = Array.from({ length: N }, () => new THREE.Vector3());
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const tmp = new THREE.Vector3();
  const scale = 1.55;

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

  const placeBonds = (mesh: THREE.InstancedMesh, bonds: [number, number][], radius: number) => {
    mesh.count = radius > 0.0005 ? bonds.length : 0;
    bonds.forEach(([a, b], k) => {
      const pa = pos[a];
      const pb = pos[b];
      tmp.subVectors(pb, pa);
      const len = tmp.length();
      q.setFromUnitVectors(up, tmp.normalize());
      sc.set(radius, len, radius);
      m4.compose(tmp.copy(pa).add(pb).multiplyScalar(0.5), q, sc);
      mesh.setMatrixAt(k, m4);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };

  const frame = (dt: number) => {
    if (morph === 0) {
      hold += dt;
      if (hold > (reduced ? 6 : 3.4)) {
        hold = 0;
        morph = 0.0001;
      }
    } else {
      morph += dt / 1.8;
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
    const counts = [0, 0, 0];
    for (let i = 0; i < N; i++) {
      pos[i].set(A[i].x + (B[i].x - A[i].x) * k, A[i].y + (B[i].y - A[i].y) * k, A[i].z + (B[i].z - A[i].z) * k).multiplyScalar(scale);
      const sp = k < 0.5 ? A[i].sp : B[i].sp;
      const mesh = atomMeshes[sp];
      // atoms swell slightly mid-relaxation, like a lattice under strain
      const rad = radii[sp] * (1 + Math.sin(k * Math.PI) * 0.12);
      m4.compose(pos[i], q.identity(), sc.setScalar(rad));
      mesh.setMatrixAt(counts[sp]++, m4);
    }
    atomMeshes.forEach((m, s) => {
      m.count = counts[s];
      m.instanceMatrix.needsUpdate = true;
    });
    placeBonds(bondsA, structs[cur].bonds, 0.022 * (1 - k));
    placeBonds(bondsB, structs[next].bonds, 0.022 * k);

    if (!dragging) {
      yawVel = damp(yawVel, reduced ? 0.05 : 0.3, 1.5, dt);
      yaw += yawVel * dt;
    }
    specimen.rotation.set(pitch, yaw, 0);
    renderer.render(scene, camera);
  };

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    w = Math.max(1, rect.width);
    h = Math.max(1, rect.height);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(canvas);
  resize();
  new IntersectionObserver(([e]) => (visible = e.isIntersecting), { rootMargin: '60px' }).observe(canvas);

  // one shared ticker for the whole page; this specimen only works while seen
  gsap.ticker.add((_t, delta) => {
    if (visible) frame(Math.min(delta / 1000, 1 / 20));
  });

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
  const end = () => (dragging = false);
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}
