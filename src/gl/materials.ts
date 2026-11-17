import * as THREE from 'three';
import { brushedTexture } from './geometry';

export interface MaterialSet {
  chrome: THREE.MeshPhysicalMaterial;
  titanium: THREE.MeshPhysicalMaterial;
  brushed: THREE.MeshPhysicalMaterial;
  graphite: THREE.MeshPhysicalMaterial;
  anodised: THREE.MeshPhysicalMaterial;
  engraving: THREE.MeshStandardMaterial;
  glass: THREE.MeshPhysicalMaterial;
  glassPane: THREE.MeshPhysicalMaterial;
  lens: THREE.MeshPhysicalMaterial;
  light: THREE.MeshBasicMaterial;
  lightDim: THREE.MeshBasicMaterial;
  transmission: boolean;
}

export function createMaterials(transmission: boolean): MaterialSet {
  const brushMap = brushedTexture();

  // Polished chrome: near-mirror, slightly cool.
  const chrome = new THREE.MeshPhysicalMaterial({
    color: '#e2e6eb',
    metalness: 1,
    roughness: 0.06,
    envMapIntensity: 1.3,
  });

  // Brushed titanium: warmer grey, circular brushing via anisotropy.
  const titanium = new THREE.MeshPhysicalMaterial({
    color: '#b9b6b0',
    metalness: 1,
    roughness: 0.3,
    roughnessMap: brushMap,
    anisotropy: 0.9,
    anisotropyRotation: 0,
    envMapIntensity: 1.45,
  });

  // Brushed aluminium: brighter and colder than titanium.
  const brushed = new THREE.MeshPhysicalMaterial({
    color: '#d4d9df',
    metalness: 1,
    roughness: 0.34,
    roughnessMap: brushMap,
    anisotropy: 0.85,
    envMapIntensity: 1.35,
  });

  // Graphite ceramic with a lacquer-like clearcoat.
  const graphite = new THREE.MeshPhysicalMaterial({
    color: '#1b1e22',
    metalness: 0.65,
    roughness: 0.42,
    clearcoat: 0.8,
    clearcoatRoughness: 0.14,
    envMapIntensity: 1.1,
  });

  // Dark anodised metal: deep blue-black with a satin sheen.
  const anodised = new THREE.MeshPhysicalMaterial({
    color: '#14181d',
    metalness: 0.9,
    roughness: 0.32,
    sheen: 0.6,
    sheenColor: new THREE.Color('#3b5966'),
    sheenRoughness: 0.4,
    clearcoat: 0.35,
    clearcoatRoughness: 0.25,
    envMapIntensity: 1.2,
  });

  const engraving = new THREE.MeshStandardMaterial({
    color: '#0a0c0e',
    metalness: 0.4,
    roughness: 0.6,
  });

  const glass = transmission
    ? new THREE.MeshPhysicalMaterial({
        color: '#ffffff',
        metalness: 0,
        roughness: 0.03,
        transmission: 1,
        thickness: 0.9,
        ior: 1.47,
        dispersion: 2.2,
        attenuationColor: new THREE.Color('#bdf3ff'),
        attenuationDistance: 2.4,
        specularIntensity: 1,
        envMapIntensity: 1.4,
        flatShading: true,
        depthWrite: false,
        premultipliedAlpha: true,
      })
    : new THREE.MeshPhysicalMaterial({
        color: '#cfe9f0',
        metalness: 0.1,
        roughness: 0.04,
        transparent: true,
        opacity: 0.28,
        envMapIntensity: 1.8,
        flatShading: true,
        depthWrite: false,
      });

  const glassPane = transmission
    ? new THREE.MeshPhysicalMaterial({
        color: '#f4fbff',
        metalness: 0,
        roughness: 0.06,
        transmission: 1,
        thickness: 0.12,
        ior: 1.5,
        specularIntensity: 1,
        envMapIntensity: 1.2,
        depthWrite: false,
        premultipliedAlpha: true,
      })
    : new THREE.MeshPhysicalMaterial({
        color: '#cfe9f0',
        roughness: 0.05,
        transparent: true,
        opacity: 0.16,
        envMapIntensity: 1.6,
        depthWrite: false,
      });

  // Small optical lenses: clear, with a faint cyan coating.
  const lens = new THREE.MeshPhysicalMaterial({
    color: '#e8fbff',
    metalness: 0,
    roughness: 0.02,
    transmission: transmission ? 1 : 0,
    transparent: !transmission,
    opacity: transmission ? 1 : 0.5,
    thickness: 0.05,
    ior: 1.6,
    iridescence: 0.6,
    iridescenceIOR: 1.4,
    envMapIntensity: 1.8,
  });

  const light = new THREE.MeshBasicMaterial({ color: new THREE.Color('#5fe9ff').multiplyScalar(1.6), toneMapped: false });
  const lightDim = new THREE.MeshBasicMaterial({ color: new THREE.Color('#bfefff').multiplyScalar(0.9), toneMapped: false });

  return { chrome, titanium, brushed, graphite, anodised, engraving, glass, glassPane, lens, light, lightDim, transmission };
}
