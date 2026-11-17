import * as THREE from 'three';

/**
 * A faint shaft of cold light falling on the object from above, like a
 * single overhead source in a dark lab. Brightest where the cone faces the
 * camera, fading at both ends; additive and very low intensity.
 */
export function lightShaft() {
  const geo = new THREE.ConeGeometry(3.6, 11, 64, 1, true);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      varying float vH;
      void main() {
        vH = position.y / 11.0 + 0.5;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uOpacity;
      varying vec3 vN;
      varying vec3 vV;
      varying float vH;
      void main() {
        float face = pow(abs(dot(normalize(vN), normalize(vV))), 2.2);
        float along = smoothstep(0.02, 0.45, vH) * (1.0 - smoothstep(0.82, 1.0, vH));
        float drift = 0.86 + 0.14 * sin(uTime * 0.35 + vH * 7.0) * sin(uTime * 0.21 + vH * 3.0);
        float a = face * along * drift * uOpacity;
        gl_FragColor = vec4(vec3(0.84, 0.92, 1.0) * a, a);
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(0, 3.4, -2.6);
  m.rotation.x = 0.18;
  m.renderOrder = -1;
  m.frustumCulled = false;
  return { mesh: m, uniforms: mat.uniforms };
}

/** A technical floor grid far below the object, fading out radially. */
export function floorGrid() {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uOpacity: { value: 0 }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vP;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vP = wp.xz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      uniform float uTime;
      varying vec2 vP;
      float line(vec2 p, float s) {
        vec2 g = p / s;
        vec2 d = abs(fract(g - 0.5) - 0.5) / fwidth(g);
        return 1.0 - min(min(d.x, d.y), 1.0);
      }
      void main() {
        float r = length(vP);
        float fine = line(vP, 0.5);
        float major = line(vP, 2.5);
        // a slow scan ring expanding across the floor
        float scan = exp(-pow((r - mod(uTime * 1.2, 22.0)) * 1.4, 2.0));
        float fade = exp(-r * 0.2);
        float a = (fine * 0.1 + major * 0.38 + scan * major * 0.8) * fade * uOpacity;
        vec3 c = mix(vec3(0.78, 0.84, 0.9), vec3(0.37, 0.9, 1.0), scan * 0.8);
        gl_FragColor = vec4(c, a);
      }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = -3.15;
  m.renderOrder = -2;
  m.frustumCulled = false;
  return { mesh: m, uniforms: mat.uniforms };
}
