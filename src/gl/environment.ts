import * as THREE from 'three';

/**
 * A procedural photo studio rendered into a PMREM environment map.
 * Mostly black, with long strip lights and one softbox, so polished metal
 * reads as dark chrome with clean, continuous highlights. One very low
 * cyan strip gives the chamfers a cold edge.
 */
export function studioEnvironment(renderer: THREE.WebGLRenderer) {
  const scene = new THREE.Scene();

  // Room: a graded black sphere.
  const room = new THREE.Mesh(
    new THREE.SphereGeometry(30, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {},
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          float up = vDir.y * 0.5 + 0.5;
          vec3 floorC = vec3(0.010, 0.011, 0.013);
          vec3 skyC = vec3(0.035, 0.038, 0.044);
          vec3 c = mix(floorC, skyC, smoothstep(0.25, 0.9, up));
          // faint horizon band, like the far wall of a dark studio
          c += vec3(0.03, 0.033, 0.036) * exp(-pow((vDir.y + 0.05) * 9.0, 2.0));
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  scene.add(room);

  const light = (w: number, h: number, intensity: number, color: THREE.ColorRepresentation, pos: THREE.Vector3Tuple, lookAt: THREE.Vector3Tuple = [0, 0, 0]) => {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide, toneMapped: false });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(...pos);
    m.lookAt(...lookAt);
    scene.add(m);
    return m;
  };

  // Key softbox overhead, slightly forward.
  light(14, 5, 2.4, '#f2f6ff', [0, 13, 4]);
  // Long vertical strips left and right: the signature chrome streaks.
  light(0.9, 22, 7.5, '#ffffff', [-12, 2, 3]);
  light(1.6, 22, 4.0, '#e8eef8', [13, 1, -2]);
  // Rim strip behind.
  light(18, 0.55, 5.5, '#dfe8f5', [0, 3.5, -14]);
  // Thin front fill so faces toward camera are not fully black.
  light(10, 0.35, 1.4, '#ffffff', [0, -1.5, 15]);
  // Broad, soft panel front-left: long gradients across the curved faces.
  light(9, 7, 0.9, '#dfe6ee', [-9, 4, 9]);
  // Second strip, high right, for a crossing highlight on the rings.
  light(0.5, 16, 6, '#ffffff', [7, 6, 9]);
  // Cyan accent: low and narrow.
  light(9, 0.22, 2.6, '#38e1ff', [-3, -9, 7]);
  // Floor bounce.
  light(30, 30, 0.08, '#9aa3ad', [0, -15, 0], [0, 0, 0]);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.02, 0.1, 60);
  pmrem.dispose();
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  });
  return rt.texture;
}
