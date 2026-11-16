import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { starShape } from '../core/textures.js';
import { shared } from '../core/shared.js';

const SCALE = 0.0135;
const MAX_SPEED = 5.9;
const ACCEL = 9.5;
const DECEL = 12;
const WALK_REF = 1.55; // world units / s at timeScale 1 (foot sync)
const RUN_REF = 3.3;

const smooth = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const damp = (cur, target, lambda, dt) => cur + (target - cur) * (1 - Math.exp(-lambda * dt));

/** The player: an animated low-poly fox with blended idle / walk / run and a knock-out sequence. */
export class Fox {
  constructor() {
    this.root = new THREE.Group();
    this.tilt = new THREE.Group();
    this.root.add(this.tilt);
    this.root.name = 'fox';
    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.facing = 1;
    this.yaw = Math.PI / 2 * 0.6;
    this.roll = 0;
    this.state = 'alive';
    this.downT = 0;
    this.speed = 0;
    this.lastAccel = 0;
    this.headWorld = new THREE.Vector3();
    this.stars = this.makeStars();
    this.root.add(this.stars);
  }

  async load(url, onProgress) {
    const gltf = await new GLTFLoader().loadAsync(url, onProgress);
    const model = gltf.scene;
    model.scale.setScalar(SCALE);
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
        const m = o.material;
        m.roughness = 0.85;
        m.metalness = 0;
        m.onBeforeCompile = (shader) => {
          shader.uniforms.uSunColor = shared.uSunColor;
          shader.uniforms.uRimBoost = { value: 1 };
          shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\nuniform vec3 uSunColor;')
            .replace('#include <emissivemap_fragment>', /* glsl */`
              #include <emissivemap_fragment>
              {
                vec3 Vd = normalize(vViewPosition);
                float rim = pow(1.0 - clamp(dot(normal, Vd), 0.0, 1.0), 3.0);
                totalEmissiveRadiance += uSunColor * diffuseColor.rgb * rim * 0.55;
              }
            `);
        };
        m.customProgramCacheKey = () => 'fox';
      }
    });
    this.model = model;
    this.tilt.add(model);
    this.head = model.getObjectByName('b_Head_05');

    this.mixer = new THREE.AnimationMixer(model);
    const clip = (name) => gltf.animations.find((a) => a.name === name);
    this.actions = {
      idle: this.mixer.clipAction(clip('Survey')),
      walk: this.mixer.clipAction(clip('Walk')),
      run: this.mixer.clipAction(clip('Run')),
    };
    for (const a of Object.values(this.actions)) {
      a.play();
      a.setEffectiveWeight(0);
    }
    this.actions.idle.setEffectiveWeight(1);
    this.update(0, 0, 8);
  }

  makeStars() {
    const g = new THREE.Group();
    const geo = new THREE.ExtrudeGeometry(starShape(0.09, 0.04), { depth: 0.02, bevelEnabled: false });
    geo.center();
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.35, 0.45), toneMapped: true });
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(geo, mat);
      s.userData.phase = (i / 3) * Math.PI * 2;
      g.add(s);
    }
    g.visible = false;
    return g;
  }

  reset() {
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0;
    this.state = 'alive';
    this.downT = 0;
    this.facing = 1;
    this.stars.visible = false;
    if (this.mixer) this.mixer.timeScale = 1;
  }

  knockOut(fromX) {
    if (this.state !== 'alive') return;
    this.state = 'down';
    this.downT = 0;
    const dir = Math.sign(this.x - fromX) || -this.facing;
    this.vx = dir * 3.2;
    this.vy = 3.6;
  }

  revive() {
    this.state = 'rising';
    this.downT = 0;
    this.vy = 2.6;
  }

  /** input: -1, 0, 1   bound: half width of the play area */
  update(dt, input, bound) {
    if (!this.mixer) return;
    const alive = this.state === 'alive';
    if (alive) {
      const target = input * MAX_SPEED;
      const prev = this.vx;
      this.vx = damp(this.vx, target, input !== 0 ? ACCEL : DECEL, dt);
      this.lastAccel = dt > 0 ? (this.vx - prev) / dt : 0;
      if (input !== 0) this.facing = Math.sign(input);
    } else {
      this.vx *= Math.exp(-2.8 * dt);
    }
    this.x += this.vx * dt;
    const b = bound - 0.85;
    if (this.x > b) { this.x = b; if (this.vx > 0) this.vx = 0; }
    if (this.x < -b) { this.x = -b; if (this.vx < 0) this.vx = 0; }

    // vertical (hop when knocked / getting up)
    if (this.state !== 'alive' || this.y > 0) {
      this.vy -= 20 * dt;
      this.y += this.vy * dt;
      if (this.y < 0) {
        this.y = 0;
        this.vy = Math.abs(this.vy) > 1.5 ? -this.vy * 0.28 : 0;
      }
    }

    this.speed = Math.abs(this.vx);
    const s = this.speed;

    // animation blending
    let wIdle = 1 - smooth(0.12, 1.3, s);
    let wRun = smooth(2.6, 4.8, s);
    let wWalk = Math.max(0, 1 - wIdle - wRun);
    if (this.state === 'down') { wIdle = 0; wWalk = 0; wRun = 1; }
    this.actions.idle.setEffectiveWeight(wIdle);
    this.actions.walk.setEffectiveWeight(wWalk);
    this.actions.run.setEffectiveWeight(wRun);
    if (alive || this.state === 'rising') {
      this.actions.walk.setEffectiveTimeScale(THREE.MathUtils.clamp(s / WALK_REF, 0.6, 1.8));
      this.actions.run.setEffectiveTimeScale(THREE.MathUtils.clamp(s / RUN_REF, 0.8, 1.9));
    }

    // orientation: face the running direction, turn a bit towards the camera when idle
    const yawTarget = this.facing * (Math.PI / 2) * (s > 0.4 ? 1 : 0.62);
    this.yaw = damp(this.yaw, yawTarget, 9, dt);
    this.root.rotation.y = this.yaw;

    // knock-out roll
    let rollTarget = 0;
    if (this.state === 'down') {
      this.downT += dt;
      rollTarget = -Math.PI / 2 * 0.94;
      this.mixer.timeScale = Math.max(0, 1 - this.downT * 1.7);
    } else if (this.state === 'rising') {
      this.downT += dt;
      this.mixer.timeScale = Math.min(1, this.downT * 2);
      if (this.downT > 0.45) this.state = 'alive';
    } else {
      // tiny lean into acceleration
      rollTarget = 0;
    }
    this.roll = damp(this.roll, rollTarget, this.state === 'down' ? 7 : 10, dt);
    this.tilt.rotation.z = this.roll;
    this.tilt.position.y = Math.abs(this.roll) / (Math.PI / 2) * 0.17;
    // pitch slightly forward when sprinting
    this.tilt.rotation.x = alive ? THREE.MathUtils.clamp(this.lastAccel * this.facing * 0.006, -0.06, 0.08) : 0;

    this.root.position.set(this.x, this.y, 0);
    this.mixer.update(dt);

    // stars over the head when knocked out
    this.stars.visible = this.state === 'down' && this.downT > 0.35;
    if (this.stars.visible && this.head) {
      this.root.updateMatrixWorld(true);
      this.head.getWorldPosition(this.headWorld);
      this.root.worldToLocal(this.headWorld);
      const t = performance.now() / 1000;
      this.stars.children.forEach((st) => {
        const a = t * 3.2 + st.userData.phase;
        st.position.set(this.headWorld.x + Math.cos(a) * 0.28, this.headWorld.y + 0.28 + Math.sin(a * 2) * 0.03, this.headWorld.z + Math.sin(a) * 0.28);
        st.rotation.y = -this.yaw;
        st.rotation.z = t * 4;
      });
    }

    shared.uPlayer.value.set(this.x, this.y, 0, this.state === 'alive' ? 1 : 0.4);
  }
}
