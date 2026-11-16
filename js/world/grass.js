import * as THREE from 'three';
import { patchMaterial, GLSL_NOISE, GLSL_WIND } from '../core/shared.js';
import { heightAt, pathCenter, pathHalfWidth, noise2, sstep } from './terrain.js';

/** Region (around the camera's view) where real 3D grass blades are placed. */
export const GRASS_Z = [-10.5, 15];
export const halfWidthAtZ = (z) => Math.min(30, (18 - z) * 0.36 * 2.4) + 1.5;

function bladeGeometry() {
  const segs = 4;
  const pos = [], uv = [], nrm = [], idx = [];
  for (let i = 0; i < segs; i++) {
    const t = i / segs;
    const w = 0.5 * Math.pow(1 - t, 0.8);
    const curl = t * t * 0.2;
    pos.push(-w, t, curl, w, t, curl);
    uv.push(0, t, 1, t);
    nrm.push(0, 0, 1, 0, 0, 1);
  }
  pos.push(0, 1, 0.2);
  uv.push(0.5, 1);
  nrm.push(0, 0, 1);
  for (let i = 0; i < segs - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const a = (segs - 1) * 2;
  idx.push(a, a + 1, a + 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Shared GLSL for anything planted in the ground that bends with the wind and the player. */
export const GLSL_PLANT = /* glsl */`
uniform vec4 uPlayer;
uniform vec4 uImpact;
vec2 plantBend(vec3 base, float t, float h, float stiff){
  vec2 w = windField(base.xz) * stiff;
  vec2 d = base.xz - uPlayer.xz;
  float pd = length(d);
  float push = (1.0 - smoothstep(0.2, 1.05, pd)) * uPlayer.w;
  w += (d / max(pd, 1e-3)) * push * 1.1;
  // expanding ripple from the last rock impact
  vec2 di = base.xz - uImpact.xy;
  float id = length(di);
  float age = uTime - uImpact.z;
  float front = 1.0 - smoothstep(0.0, 0.9, abs(id - age * 7.0));
  w += (di / max(id, 1e-3)) * front * uImpact.w * max(0.0, 1.0 - age * 1.4) * exp(-id * 0.25) * 1.6;
  return w * t * t * h;
}
`;

export function createGrass(theme, maxCount) {
  const geo = bladeGeometry();
  const c = theme.cur;
  const uniforms = {
    uGrassBase: { value: c.grassBase },
    uGrassTip: { value: c.grassTip },
    uGrassDry: { value: c.grassDry },
  };
  const mat = patchMaterial(
    new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.82, metalness: 0 }),
    'grass',
    (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec4 aBlade;
          varying float vGrassT;
          varying float vGrassRand;
          ${GLSL_NOISE}
          ${GLSL_WIND}
          ${GLSL_PLANT}`)
        .replace('#include <beginnormal_vertex>', /* glsl */`
          float bCa = cos(aBlade.x), bSa = sin(aBlade.x);
          vec3 objectNormal = normalize(mix(vec3(bSa, 0.0, bCa), vec3(0.0, 1.0, 0.0), 0.62));
        `)
        .replace('#include <begin_vertex>', /* glsl */`
          vec3 transformed = position;
          float bh = aBlade.y;
          transformed.x *= aBlade.z;
          transformed.yz *= bh;
          transformed.xz = vec2(transformed.x * bCa + transformed.z * bSa, -transformed.x * bSa + transformed.z * bCa);
          vec3 bBase = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          float bt = position.y;
          vec2 disp = plantBend(bBase, bt, bh, 0.34);
          transformed.xz += disp;
          transformed.y -= dot(disp, disp) / max(bh, 0.05) * 0.4 * bt;
          vGrassT = bt;
          vGrassRand = aBlade.w;
        `);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform vec3 uGrassBase, uGrassTip, uGrassDry;
          varying float vGrassT;
          varying float vGrassRand;`)
        .replace('#include <color_fragment>', /* glsl */`
          vec3 gc = mix(uGrassBase, uGrassTip, smoothstep(0.0, 1.0, vGrassT));
          gc = mix(gc, uGrassDry, step(0.86, vGrassRand) * 0.55 * vGrassT);
          gc *= 0.8 + 0.4 * fract(vGrassRand * 7.31);
          gc *= mix(0.42, 1.0, smoothstep(0.0, 0.6, vGrassT));
          diffuseColor.rgb = gc;
        `)
        .replace('#include <normal_fragment_begin>',
          THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''))
        .replace('#include <emissivemap_fragment>', /* glsl */`
          #include <emissivemap_fragment>
          totalEmissiveRadiance += gc * 0.1 * vGrassT;
        `);
    },
  );

  const mesh = new THREE.InstancedMesh(geo, mat, maxCount);
  const aBlade = new Float32Array(maxCount * 4);
  const m = new THREE.Matrix4();
  let n = 0, guard = 0;
  const [z0, z1] = GRASS_Z;
  while (n < maxCount && guard++ < maxCount * 20) {
    // sample z with more density close to the camera and the path
    const z = z0 + Math.random() * (z1 - z0);
    const hwz = halfWidthAtZ(z);
    const x = (Math.random() * 2 - 1) * hwz;
    const dzp = z - pathCenter(x);
    const hw = pathHalfWidth(x);
    const adz = Math.abs(dzp);
    const clump = noise2(x * 0.35 + 11.0, z * 0.35) * 0.5 + 0.5;
    let prob, h;
    if (adz < hw * 0.8) { prob = 0.04; h = 0.08 + Math.random() * 0.08; }
    else if (adz < hw * 1.25) { prob = 0.45; h = 0.12 + Math.random() * 0.16; }
    else if (dzp < 0) {
      // behind the path: lush and taller
      prob = 0.75 + 0.25 * clump;
      h = (0.3 + Math.random() * 0.4) * (0.7 + 0.7 * clump);
    } else {
      // in front: short near the path so the fox stays visible, taller near the camera
      prob = 0.7 + 0.3 * clump;
      h = Math.min(0.62, 0.16 + 0.06 * (dzp - 1.2)) * (0.75 + 0.5 * Math.random()) * (0.8 + 0.4 * clump);
    }
    // fade out at the borders of the region
    const edge = sstep(z0, z0 + 2.5, z) * (1 - sstep(hwz * 0.85, hwz, Math.abs(x)));
    prob *= 0.25 + 0.75 * edge;
    h *= 0.35 + 0.65 * edge;
    if (Math.random() > prob) continue;
    const y = heightAt(x, z) - 0.02;
    m.makeTranslation(x, y, z);
    mesh.setMatrixAt(n, m);
    aBlade[n * 4] = Math.random() * Math.PI * 2;
    aBlade[n * 4 + 1] = h;
    aBlade[n * 4 + 2] = 0.05 + Math.random() * 0.035 + h * 0.03;
    aBlade[n * 4 + 3] = Math.random();
    n++;
  }
  mesh.count = n;
  mesh.userData.maxCount = n;
  geo.setAttribute('aBlade', new THREE.InstancedBufferAttribute(aBlade, 4));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = 'grass';
  return mesh;
}
