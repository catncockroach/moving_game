import * as THREE from 'three';
import { shared } from '../core/shared.js';
import { butterflyTexture, singleLeafTexture } from '../core/textures.js';
import { heightAt } from './terrain.js';

/* ---------------- Pollen motes (day) / fireflies (night) ---------------- */
export function createMotes(theme, count) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() * 2 - 1) * 17;
    pos[i * 3 + 1] = Math.random();
    pos[i * 3 + 2] = -9 + Math.random() * 15;
    seed.set([Math.random() * 100, Math.random(), Math.random(), Math.random()], i * 4);
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  const uniforms = {
    uTime: shared.uTime,
    uWindDir: shared.uWindDir,
    uSunView: shared.uSunView,
    uColor: { value: theme.cur.motes },
    uMode: { value: theme.cur.moteMode },
    uScale: { value: 600 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      attribute vec4 aSeed;
      uniform float uTime, uMode, uScale;
      uniform vec2 uWindDir;
      uniform vec3 uSunView;
      varying float vA;
      void main(){
        vec3 p = position;
        float s = aSeed.x;
        // height band: pollen floats higher, fireflies stay low
        p.y = mix(0.4 + p.y * 4.5, 0.25 + p.y * 2.2, uMode);
        float drift = uTime * (0.25 + aSeed.y * 0.25) * (1.0 - uMode * 0.7);
        p.x += uWindDir.x * drift * 2.0;
        p.x = mod(p.x + 17.0, 34.0) - 17.0;
        p += vec3(sin(uTime * 0.35 + s) * 0.7, sin(uTime * 0.5 + s * 1.7) * 0.35, cos(uTime * 0.3 + s * 1.3) * 0.6);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float size = mix(0.035 + aSeed.z * 0.03, 0.09 + aSeed.z * 0.05, uMode);
        gl_PointSize = max(1.5, size * uScale / -mv.z);
        // fireflies blink, pollen glints when back-lit
        float blink = smoothstep(0.35, 1.0, sin(uTime * (0.9 + aSeed.w) + s * 6.0));
        float glint = 0.35 + 0.65 * pow(max(dot(normalize(mv.xyz), uSunView), 0.0), 3.0);
        vA = mix(glint * (0.55 + 0.45 * aSeed.w), blink, uMode);
        vA *= (1.0 - smoothstep(-4.0, -1.0, mv.z)); // fade very close to the camera
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uMode;
      varying float vA;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        float core = (1.0 - smoothstep(0.0, 0.5, d));
        float a = pow(core, mix(2.2, 1.6, uMode)) * vA;
        if (a < 0.004) discard;
        gl_FragColor = vec4(uColor * (1.0 + uMode * 2.5) * a, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const points = new THREE.Points(g, mat);
  points.frustumCulled = false;
  points.renderOrder = 6;
  return {
    object: points,
    setScale(v) { uniforms.uScale.value = v; },
    update(theme) { uniforms.uMode.value = theme.cur.moteMode; },
  };
}

/* ---------------- Butterflies ---------------- */
export function createButterflies(count) {
  const group = new THREE.Group();
  const palettes = [['#ffb347', '#5a2d0c'], ['#fdf6e3', '#3a3a3a'], ['#8ec5ff', '#1f3b73'], ['#ffe066', '#6b4f0a']];
  const items = [];
  for (let i = 0; i < count; i++) {
    const [main, edge] = palettes[i % palettes.length];
    const tex = butterflyTexture(main, edge);
    const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6 });
    const wingGeo = new THREE.PlaneGeometry(0.2, 0.2);
    wingGeo.translate(0.1, 0, 0);
    wingGeo.rotateX(-Math.PI / 2);
    const right = new THREE.Mesh(wingGeo, mat);
    const left = new THREE.Mesh(wingGeo, mat);
    left.scale.x = -1;
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.09, 3, 6).rotateX(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#2b2118', roughness: 0.8 }));
    const b = new THREE.Group();
    b.add(right, left, body);
    const home = new THREE.Vector3((Math.random() * 2 - 1) * 10, 1.2, i % 2 ? -3.5 - Math.random() * 3 : 2.5 + Math.random() * 2);
    const item = {
      obj: b, right, left,
      pos: home.clone(), vel: new THREE.Vector3(), target: home.clone(), home,
      phase: Math.random() * 10, retarget: 0,
    };
    b.position.copy(home);
    group.add(b);
    items.push(item);
  }
  return {
    group,
    update(dt, t) {
      for (const it of items) {
        it.retarget -= dt;
        if (it.retarget <= 0 || it.pos.distanceTo(it.target) < 0.4) {
          it.retarget = 2 + Math.random() * 3;
          it.target.set(
            THREE.MathUtils.clamp(it.home.x + (Math.random() * 2 - 1) * 5, -16, 16),
            0.5 + Math.random() * 2.2,
            it.home.z + (Math.random() * 2 - 1) * 1.2,
          );
          it.target.y += heightAt(it.target.x, it.target.z);
        }
        const steer = it.target.clone().sub(it.pos).normalize().multiplyScalar(1.4);
        it.vel.lerp(steer, 1 - Math.exp(-1.6 * dt));
        it.vel.y += Math.sin(t * 7 + it.phase) * 0.9 * dt * 6;
        it.pos.addScaledVector(it.vel, dt);
        it.obj.position.copy(it.pos);
        it.obj.rotation.y = Math.atan2(it.vel.x, it.vel.z);
        const flap = Math.sin(t * 16 + it.phase);
        const ang = 0.25 + (flap * 0.5 + 0.5) * 1.15;
        it.right.rotation.z = ang;
        it.left.rotation.z = -ang;
      }
    },
  };
}

/* ---------------- Distant birds ---------------- */
export function createBirds() {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: '#2a3238', side: THREE.DoubleSide, fog: true });
  const wing = new THREE.BufferGeometry();
  wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.18, 0, 0, -0.15, 0.9, 0, -0.05], 3));
  const birds = [];
  for (let i = 0; i < 5; i++) {
    const b = new THREE.Group();
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.6, 4).rotateX(Math.PI / 2), mat);
    const l = new THREE.Mesh(wing, mat), r = new THREE.Mesh(wing, mat);
    r.scale.x = -1;
    b.add(body, l, r);
    b.visible = false;
    group.add(b);
    birds.push({ obj: b, l, r, off: new THREE.Vector3(), phase: Math.random() * 6 });
  }
  let next = 6 + Math.random() * 8, active = false, t0 = 0, dir = 1, z = -70, y = 22, speed = 6;
  return {
    group,
    update(dt, t) {
      if (!active) {
        next -= dt;
        if (next <= 0) {
          active = true; t0 = t; dir = Math.random() < 0.5 ? 1 : -1;
          z = -55 - Math.random() * 35; y = 13 + Math.random() * 8; speed = 5 + Math.random() * 2;
          const n = 3 + Math.floor(Math.random() * 3);
          birds.forEach((b, i) => {
            b.obj.visible = i < n;
            b.off.set(-i * 1.6 * dir + (Math.random() - 0.5), (i % 2) * 0.8 + Math.random() * 0.5, (Math.random() - 0.5) * 3);
          });
        }
        return;
      }
      const e = t - t0;
      const x = -dir * 70 + dir * e * speed;
      birds.forEach((b) => {
        if (!b.obj.visible) return;
        b.obj.position.set(x + b.off.x, y + b.off.y + Math.sin(e * 0.8 + b.phase) * 0.4, z + b.off.z);
        b.obj.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
        const flap = Math.sin(e * 9 + b.phase);
        const glide = Math.sin(e * 0.7 + b.phase) > 0.3 ? 0.15 : 1;
        b.l.rotation.z = flap * 0.7 * glide + 0.1;
        b.r.rotation.z = -flap * 0.7 * glide - 0.1;
        b.obj.scale.setScalar(1.6);
      });
      if (Math.abs(x) > 75) {
        active = false;
        next = 18 + Math.random() * 20;
        birds.forEach((b) => (b.obj.visible = false));
      }
    },
  };
}

/* ---------------- Falling leaves (background only) ---------------- */
export function createFallingLeaves(theme, canopies, count = 10) {
  const tex = singleLeafTexture();
  const group = new THREE.Group();
  const leaves = [];
  const colorKeys = ['leaf0', 'leaf1', 'leaf2', 'leaf3'];
  for (let i = 0; i < count; i++) {
    const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.14), mat);
    m.visible = false;
    group.add(m);
    leaves.push({ m, key: colorKeys[i % 4], life: 0, pos: new THREE.Vector3(), phase: 0, ground: 0, rest: 0 });
  }
  let clock = 1;
  return {
    group,
    update(dt, t, theme) {
      clock -= dt * (theme.name === 'autumn' ? 2.5 : 0.7);
      if (clock <= 0 && canopies.length) {
        clock = 1 + Math.random();
        const L = leaves.find((l) => l.life <= 0);
        if (L) {
          const c = canopies[Math.floor(Math.random() * canopies.length)];
          L.pos.set(c.x + (Math.random() - 0.5) * 2.5, c.y + Math.random(), Math.min(-2.2, c.z + (Math.random() - 0.5) * 1.5));
          L.ground = heightAt(L.pos.x, L.pos.z) + 0.03;
          L.life = 1; L.rest = 0; L.phase = Math.random() * 10;
          L.m.visible = true;
          L.m.material.opacity = 1;
        }
      }
      for (const L of leaves) {
        if (L.life <= 0) continue;
        L.m.material.color.copy(theme.cur[L.key]).multiplyScalar(1.15);
        if (L.pos.y > L.ground) {
          L.pos.y -= dt * 0.55;
          L.pos.x += (Math.sin(t * 1.3 + L.phase) * 0.6 + shared.uWindDir.value.x * 0.5 * shared.uWindStrength.value) * dt;
          L.pos.z += Math.cos(t * 1.1 + L.phase) * 0.25 * dt;
          L.m.rotation.set(Math.sin(t * 2.1 + L.phase) * 1.2, t * 1.5 + L.phase, Math.cos(t * 1.7 + L.phase) * 0.9);
        } else {
          L.pos.y = L.ground;
          L.m.rotation.set(-Math.PI / 2, 0, L.phase);
          L.rest += dt;
          if (L.rest > 4) { L.life = 0; L.m.visible = false; }
        }
        L.m.position.copy(L.pos);
      }
    },
  };
}
