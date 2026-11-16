import * as THREE from 'three';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { patchMaterial, GLSL_NOISE, shared } from '../core/shared.js';

const perlin = new ImprovedNoise();
export const noise2 = (x, z) => perlin.noise(x, 0.47, z);
export const sstep = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/* The dirt path the fox runs on wanders gently around z = 0. */
export const pathCenter = (x) => 0.22 * Math.sin(x * 0.21 + 1.3) + 0.12 * Math.sin(x * 0.53 + 0.4);
export const pathHalfWidth = (x) => 1.0 + 0.16 * Math.sin(x * 0.37 + 2.0) + 0.07 * Math.sin(x * 1.13);

const GLSL_PATH = /* glsl */`
float pathCenterG(float x){ return 0.22 * sin(x * 0.21 + 1.3) + 0.12 * sin(x * 0.53 + 0.4); }
float pathHalfG(float x){ return 1.0 + 0.16 * sin(x * 0.37 + 2.0) + 0.07 * sin(x * 1.13); }
`;

/** Terrain height: flat around the path, small undulations, hills rising in the back. */
export function heightAt(x, z) {
  const dz = Math.abs(z - pathCenter(x));
  const flat = sstep(1.5, 4.5, dz);
  let h = (noise2(x * 0.09, z * 0.09) * 0.7 + noise2(x * 0.23 + 3.1, z * 0.23) * 0.22) * flat;
  const back = sstep(-14, -80, z);
  h += back * (2.6 + noise2(x * 0.02, z * 0.02 + 5.0) * 4.5 + noise2(x * 0.07, z * 0.07) * 1.4);
  h += sstep(-80, -190, z) * (3 + noise2(x * 0.012 + 9.0, 1.0) * 4);
  h -= sstep(5, 18, z) * 0.8;
  return h;
}

function axis(ranges) {
  // ranges: [[from, to, step], ...] -> sorted unique coordinates
  const out = [];
  for (const [a, b, s] of ranges) for (let v = a; v < b - 1e-6; v += s) out.push(v);
  out.push(ranges[ranges.length - 1][1]);
  return out;
}

export function createGround(theme) {
  const xs = axis([[-160, -40, 5], [-40, 40, 0.5], [40, 160, 5]]);
  const zs = axis([[-200, -60, 5], [-60, -20, 1], [-20, 22, 0.5], [22, 50, 2]]);
  const nx = xs.length, nz = zs.length;
  const pos = new Float32Array(nx * nz * 3);
  let p = 0;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = xs[i], z = zs[j];
      pos[p++] = x; pos[p++] = heightAt(x, z); pos[p++] = z;
    }
  }
  const index = [];
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();

  const c = theme.cur;
  const uniforms = {
    uGround1: { value: c.ground1 },
    uGround2: { value: c.ground2 },
    uPath: { value: c.path },
    uGrassBase: { value: c.grassBase },
  };
  const mat = patchMaterial(new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 }), 'ground', (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos;
        uniform vec3 uGround1, uGround2, uPath, uGrassBase;
        ${GLSL_NOISE}
        ${GLSL_PATH}`)
      .replace('#include <color_fragment>', /* glsl */`
        vec2 wp = vWPos.xz;
        float n1 = fbm2(wp * 0.07);
        float n2 = snoise(wp * 0.6);
        float n3 = snoise(wp * 2.7);
        vec3 g = mix(uGround1, uGround2, smoothstep(-0.45, 0.55, n1));
        g = mix(g, uGrassBase, 0.3 * (1.0 - smoothstep(10.0, 40.0, abs(wp.y))));
        g *= 0.9 + 0.08 * n2 + 0.05 * n3;
        float dz = abs(wp.y - pathCenterG(wp.x)) + snoise(wp * 0.9) * 0.12;
        float hw = pathHalfG(wp.x);
        float pm = 1.0 - smoothstep(hw * 0.78, hw * 1.15, dz);
        vec3 dirt = uPath * (0.86 + 0.14 * snoise(wp * 1.5));
        dirt = mix(dirt, uPath * 0.72, smoothstep(0.25, 0.95, snoise(wp * 4.1)) * 0.45);
        float peb = smoothstep(0.78, 0.9, snoise(wp * 7.3 + 3.0));
        dirt = mix(dirt, uPath * 1.28, peb * 0.6);
        dirt *= mix(1.0, 0.8, smoothstep(hw * 0.45, hw * 1.0, dz));
        diffuseColor.rgb = mix(g, dirt, pm);
      `);
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'ground';
  return mesh;
}

/** Distant hazy ridges (painted-backdrop style) — cheap and very effective for depth. */
export function createRidges(theme) {
  const group = new THREE.Group();
  const c = theme.cur;
  const layers = [
    { z: -235, base: 5, amp: 24, freq: 0.011, seed: 3.3, color: c.hill, hazeKey: 'hillHaze', ridged: false },
    { z: -390, base: 22, amp: 58, freq: 0.007, seed: 8.1, color: c.mountain, hazeKey: 'mountainHaze', ridged: true },
  ];
  const mats = [];
  for (const L of layers) {
    const cols = 260;
    const W = 1400;
    const pos = [], hv = [], nrm = [], idx = [];
    const hf = (x) => {
      let n = perlin.noise(x * L.freq, L.seed, 0.3) * 0.65 + perlin.noise(x * L.freq * 2.7, L.seed + 3, 0.7) * 0.3
        + perlin.noise(x * L.freq * 7.0, L.seed + 9, 0.1) * 0.08;
      if (L.ridged) n = 1 - Math.abs(n * 1.6);
      else n = n * 0.5 + 0.5;
      return L.base + Math.max(0, n) * L.amp;
    };
    for (let i = 0; i <= cols; i++) {
      const x = -W / 2 + (i / cols) * W;
      const h = hf(x);
      const dh = (hf(x + 2) - hf(x - 2)) / 4;
      const n = new THREE.Vector3(-dh, 1, 0.35).normalize();
      // slight curve so the ends wrap around the camera
      const z = L.z + (x * x) / 9000;
      pos.push(x, h, z, x, -30, z);
      hv.push(1, 0);
      nrm.push(n.x, n.y, n.z, 0, 1, 0.3);
      if (i < cols) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geo.setAttribute('aH', new THREE.Float32BufferAttribute(hv, 1));
    geo.setIndex(idx);
    const uniforms = {
      uColor: { value: L.color },
      uHorizon: { value: c.fog },
      uHaze: { value: c[L.hazeKey] },
      uSunDir: shared.uSunDir,
      uSunColor: shared.uSunColor,
    };
    const mat = new THREE.ShaderMaterial({
      uniforms,
      fog: false,
      vertexShader: /* glsl */`
        attribute float aH;
        varying float vH;
        varying vec3 vN;
        void main(){
          vH = aH;
          vN = normal;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor, uHorizon, uSunColor, uSunDir;
        uniform float uHaze;
        varying float vH;
        varying vec3 vN;
        void main(){
          float l = 0.62 + 0.5 * max(dot(normalize(vN), uSunDir), 0.0);
          vec3 col = uColor * l * mix(vec3(1.0), uSunColor, 0.25);
          float haze = uHaze + (1.0 - uHaze) * (1.0 - smoothstep(0.35, 0.95, vH)) * 0.75;
          col = mix(col, uHorizon, clamp(haze, 0.0, 1.0));
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    mats.push({ mat, key: L.hazeKey });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = -5;
    group.add(mesh);
  }
  group.name = 'ridges';
  return {
    group,
    update(theme) {
      for (const m of mats) m.mat.uniforms.uHaze.value = theme.cur[m.key];
    },
  };
}
