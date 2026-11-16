import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { shared, GLSL_NOISE } from '../core/shared.js';

const perlin = new ImprovedNoise();

/** Soft round contact shadow drawn procedurally (no texture → no mip-map fading at grazing angles). */
export function blobShadowMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 0 } },
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uOpacity;
      varying vec2 vUv;
      void main(){
        float d = length(vUv - 0.5) * 2.0;
        float a = (1.0 - smoothstep(0.15, 1.0, d)) * uOpacity;
        gl_FragColor = vec4(uColor, a);
        #include <colorspace_fragment>
      }`,
  });
}


/**
 * Procedural mossy rock: noisy icosphere with a few planar cuts (chiselled look)
 * and baked vertex colours (stone, crevices, moss on top).
 */
export function makeRockGeometry(seed, detail = 3, mossy = true) {
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  const rnd = (k) => {
    const x = Math.sin(seed * 127.1 + k * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  const cuts = [];
  for (let i = 0; i < 4; i++) {
    const n = new THREE.Vector3(rnd(i) * 2 - 1, rnd(i + 10) * 2 - 1, rnd(i + 20) * 2 - 1).normalize();
    cuts.push({ n, d: 0.72 + rnd(i + 30) * 0.18 });
  }
  cuts.push({ n: new THREE.Vector3(0, -1, 0), d: 0.62 }); // flatter bottom
  const sx = 1 + rnd(40) * 0.35, sy = 0.72 + rnd(41) * 0.25, sz = 0.9 + rnd(42) * 0.3;
  const disp = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    const n = perlin.noise(v.x * 1.7 + seed, v.y * 1.7, v.z * 1.7) * 0.32
      + perlin.noise(v.x * 4.3 + seed, v.y * 4.3, v.z * 4.3) * 0.09;
    v.multiplyScalar(1 + n);
    for (const c of cuts) {
      const d = v.dot(c.n);
      if (d > c.d) v.addScaledVector(c.n, -(d - c.d) * 0.85);
    }
    disp[i] = n;
    v.set(v.x * sx, v.y * sy, v.z * sz);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const nrm = g.attributes.normal;
  const col = new Float32Array(p.count * 3);
  const stone = new THREE.Color();
  const moss = new THREE.Color('#4f7a2a');
  const mossLight = new THREE.Color('#7a9c3a');
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const grain = perlin.noise(v.x * 6 + seed, v.y * 6, v.z * 6);
    const tone = 0.36 + grain * 0.12 + disp[i] * 0.35;
    stone.setRGB(tone * 1.02, tone, tone * 0.95, THREE.SRGBColorSpace);
    if (mossy) {
      const ny = nrm.getY(i);
      const m = THREE.MathUtils.smoothstep(ny + perlin.noise(v.x * 3, v.y * 3 + seed, v.z * 3) * 0.5, 0.45, 0.85);
      stone.lerp(moss.clone().lerp(mossLight, 0.5 + grain), m * 0.9);
    }
    col.set([stone.r, stone.g, stone.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

export const rockMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 });
// soft rim light so rocks always read clearly against the foliage (also at night)
rockMaterial.onBeforeCompile = (shader) => {
  shader.uniforms.uSunColor = shared.uSunColor;
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform vec3 uSunColor;')
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      {
        float rim = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 2.5);
        totalEmissiveRadiance += (uSunColor * 0.5 + 0.25) * rim * 0.35;
      }`);
};
rockMaterial.customProgramCacheKey = () => 'rock-rim';

/** Dust puffs, flying debris and fading ground marks. */
export class Effects {
  constructor(scene, theme) {
    this.scene = scene;
    this.theme = theme;

    // ---- dust (points)
    this.maxDust = 420;
    const g = new THREE.BufferGeometry();
    this.dPos = new Float32Array(this.maxDust * 3);
    this.dSize = new Float32Array(this.maxDust);
    this.dAlpha = new Float32Array(this.maxDust);
    this.dSeed = new Float32Array(this.maxDust).map(() => Math.random() * 100);
    g.setAttribute('position', new THREE.BufferAttribute(this.dPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.dSize, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.dAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSeed', new THREE.BufferAttribute(this.dSeed, 1));
    this.dust = [];
    for (let i = 0; i < this.maxDust; i++) this.dust.push({ life: 0, max: 1, x: 0, y: -99, z: 0, vx: 0, vy: 0, vz: 0, s0: 0, s1: 0, a: 0 });
    this.dustMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: theme.cur.dust },
        uSunColor: shared.uSunColor,
        uScale: { value: 600 },
      },
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */`
        attribute float aSize; attribute float aAlpha; attribute float aSeed;
        uniform float uScale;
        varying float vA; varying float vSeed;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uScale / max(-mv.z, 0.1);
          vA = aAlpha; vSeed = aSeed;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor; uniform vec3 uSunColor;
        varying float vA; varying float vSeed;
        ${GLSL_NOISE}
        void main(){
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          float n = snoise(c * 3.5 + vSeed) * 0.5 + 0.5;
          float a = (1.0 - smoothstep(0.12, 0.5, d + (n - 0.5) * 0.22)) * vA;
          if (a < 0.01) discard;
          vec3 col = uColor * (0.75 + 0.35 * uSunColor) * (0.9 + 0.2 * n);
          gl_FragColor = vec4(col, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.dustPoints = new THREE.Points(g, this.dustMat);
    this.dustPoints.frustumCulled = false;
    this.dustPoints.renderOrder = 5;
    scene.add(this.dustPoints);

    // ---- debris (instanced chunks)
    this.maxDebris = 90;
    const dg = makeRockGeometry(77.7, 0, false);
    this.debrisMesh = new THREE.InstancedMesh(dg, rockMaterial, this.maxDebris);
    this.debrisMesh.frustumCulled = false;
    this.debrisMesh.castShadow = false;
    this.debris = [];
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.maxDebris; i++) {
      this.debris.push({ life: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Euler(), spin: new THREE.Vector3(), s: 0 });
      this.debrisMesh.setMatrixAt(i, zero);
    }
    scene.add(this.debrisMesh);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();

    // ---- ground marks
    this.marks = [];
    const markGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(markGeo, blobShadowMaterial(0x2a2114));
      m.visible = false;
      m.renderOrder = 2;
      m.userData.life = 0;
      scene.add(m);
      this.marks.push(m);
    }
    this.markIdx = 0;
  }

  setViewport(heightPx, fovDeg) {
    this.dustMat.uniforms.uScale.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
  }

  puff(x, y, z, { count = 10, spread = 1, up = 1, size = 0.5, life = 1.1, alpha = 0.55 } = {}) {
    let spawned = 0;
    for (const d of this.dust) {
      if (d.life > 0) continue;
      const a = Math.random() * Math.PI * 2;
      const sp = (0.6 + Math.random()) * spread;
      d.x = x + Math.cos(a) * 0.1; d.y = y + 0.05; d.z = z + Math.sin(a) * 0.1;
      d.vx = Math.cos(a) * sp * 1.6;
      d.vz = Math.sin(a) * sp * 0.9;
      d.vy = (0.25 + Math.random() * 0.8) * up;
      d.max = d.life = life * (0.7 + Math.random() * 0.6);
      d.s0 = size * (0.5 + Math.random() * 0.5);
      d.s1 = d.s0 * (2.2 + Math.random());
      d.a = alpha * (0.6 + Math.random() * 0.4);
      if (++spawned >= count) break;
    }
  }

  impact(x, y, z, r) {
    this.puff(x, y, z, { count: Math.round(10 + r * 16), spread: 0.6 + r, up: 0.8 + r * 0.6, size: 0.45 + r * 0.55, life: 1.2 + r * 0.5, alpha: 0.6 });
    // debris
    const n = Math.round(4 + r * 7);
    let k = 0;
    for (const d of this.debris) {
      if (d.life > 0) continue;
      d.life = 1.4 + Math.random() * 0.6;
      d.pos.set(x + (Math.random() - 0.5) * r, y + r * 0.4, z + (Math.random() - 0.5) * r * 0.6);
      const a = Math.random() * Math.PI * 2;
      const sp = 1.2 + Math.random() * 2.6 * (0.6 + r);
      d.vel.set(Math.cos(a) * sp, 2.5 + Math.random() * 3.5 * (0.5 + r), Math.sin(a) * sp * 0.6);
      d.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      d.spin.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
      d.s = r * (0.14 + Math.random() * 0.16);
      if (++k >= n) break;
    }
    // ground mark
    const m = this.marks[this.markIdx++ % this.marks.length];
    m.position.set(x, y + 0.03, z);
    m.scale.set(r * 2.6, 1, r * 4.2);
    m.userData.life = 1;
    m.visible = true;
  }

  update(dt, groundAt) {
    // dust
    for (let i = 0; i < this.maxDust; i++) {
      const d = this.dust[i];
      if (d.life > 0) {
        d.life -= dt;
        const t = 1 - d.life / d.max;
        const drag = Math.exp(-3.2 * dt);
        d.vx *= drag; d.vz *= drag; d.vy = d.vy * drag + 0.15 * dt;
        d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
        this.dPos[i * 3] = d.x; this.dPos[i * 3 + 1] = d.y; this.dPos[i * 3 + 2] = d.z;
        this.dSize[i] = d.s0 + (d.s1 - d.s0) * (1 - Math.pow(1 - t, 2));
        this.dAlpha[i] = d.a * Math.min(1, t * 8) * (1 - t) * (1 - t);
      } else if (this.dAlpha[i] !== 0) {
        this.dAlpha[i] = 0;
        this.dPos[i * 3 + 1] = -99;
      }
    }
    const ga = this.dustPoints.geometry.attributes;
    ga.position.needsUpdate = true;
    ga.aSize.needsUpdate = true;
    ga.aAlpha.needsUpdate = true;

    // debris
    let any = false;
    for (let i = 0; i < this.maxDebris; i++) {
      const d = this.debris[i];
      if (d.life <= 0) continue;
      any = true;
      d.life -= dt;
      d.vel.y -= 16 * dt;
      d.pos.addScaledVector(d.vel, dt);
      const gy = groundAt(d.pos.x, d.pos.z) + d.s * 0.5;
      if (d.pos.y < gy) {
        d.pos.y = gy;
        d.vel.y = Math.abs(d.vel.y) > 1.2 ? -d.vel.y * 0.3 : 0;
        d.vel.x *= 0.6; d.vel.z *= 0.6;
        d.spin.multiplyScalar(0.6);
      }
      d.rot.x += d.spin.x * dt; d.rot.y += d.spin.y * dt; d.rot.z += d.spin.z * dt;
      const fade = Math.min(1, d.life / 0.4);
      this._q.setFromEuler(d.rot);
      this._s.setScalar(d.life > 0 ? d.s * fade : 0);
      this._m.compose(d.pos, this._q, this._s);
      this.debrisMesh.setMatrixAt(i, this._m);
    }
    if (any || this._debrisWasActive) this.debrisMesh.instanceMatrix.needsUpdate = true;
    this._debrisWasActive = any;

    // ground marks
    for (const m of this.marks) {
      if (!m.visible) continue;
      m.userData.life -= dt / 2.8;
      m.material.uniforms.uOpacity.value = Math.max(0, m.userData.life) * 0.6;
      if (m.userData.life <= 0) m.visible = false;
    }
  }
}
