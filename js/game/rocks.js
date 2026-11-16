import * as THREE from 'three';
import { makeRockGeometry, rockMaterial, blobShadowMaterial } from './effects.js';

/** Difficulty curve — kept close to the original: more and faster rocks over time. */
export function difficulty(t) {
  const k = 1 - Math.exp(-t / 55);
  return {
    rate: Math.min(6.2, 0.95 + t * 0.07),      // rocks per second (for a full-width field)
    fallTime: 2.25 - 1.3 * k,                  // seconds from top of view to the ground
    aimed: Math.min(0.42, 0.2 + t * 0.003),     // share of rocks aimed near the fox
    boulder: Math.min(0.12, 0.04 + t * 0.001),
  };
}

export class Rocks {
  constructor(scene, effects, audio) {
    this.scene = scene;
    this.effects = effects;
    this.audio = audio;
    this.geos = Array.from({ length: 7 }, (_, i) => makeRockGeometry(i * 3.17 + 1.3, 3, true));
    this.shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.active = [];
    this.pool = [];
    this.spawnClock = 0.6;
    this.onImpact = null;
  }

  obtain() {
    let r = this.pool.pop();
    if (!r) {
      const mesh = new THREE.Mesh(this.geos[0], rockMaterial);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      const shadow = new THREE.Mesh(this.shadowGeo, blobShadowMaterial(0x0a1006));
      shadow.renderOrder = 3;
      r = { mesh, shadow, axis: new THREE.Vector3() };
    }
    this.scene.add(r.mesh, r.shadow);
    return r;
  }

  release(r) {
    this.scene.remove(r.mesh, r.shadow);
    this.pool.push(r);
  }

  spawn({ x, radius, fallTime, topY, groundY }) {
    const r = this.obtain();
    r.mesh.geometry = this.geos[Math.floor(Math.random() * this.geos.length)];
    r.x = x;
    r.r = radius;
    r.groundY = groundY;
    r.y0 = topY + radius * 1.2;
    r.y = r.y0;
    r.H = r.y0 - (groundY + radius * 0.8);
    r.v = 0.6 * r.H / fallTime;
    r.a = 0.8 * r.H / (fallTime * fallTime);
    r.axis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    r.spin = (Math.random() * 2 + 1) * (Math.random() < 0.5 ? -1 : 1) / Math.max(0.5, radius);
    r.mesh.scale.setScalar(radius);
    r.mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    r.mesh.position.set(x, r.y, 0);
    r.shadow.position.set(x, groundY + 0.035, 0);
    r.shadow.material.uniforms.uOpacity.value = 0;
    this.active.push(r);
    return r;
  }

  /**
   * ctx: { spawning, elapsed, foxX, foxVx, bound, topY, groundAt(x) }
   * Returns the rock that hit the fox (or null).
   */
  update(dt, ctx, hitTest) {
    if (ctx.spawning) {
      const d = difficulty(ctx.elapsed);
      const widthFactor = ctx.bound / 8.5;
      this.spawnClock -= dt * d.rate * Math.max(0.45, widthFactor);
      while (this.spawnClock <= 0) {
        this.spawnClock += 0.55 + Math.random() * 0.9;
        this.spawnOne(ctx, d);
      }
    }

    let hit = null;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const r = this.active[i];
      r.v += r.a * dt;
      r.y -= r.v * dt;
      r.mesh.position.y = r.y;
      r.mesh.rotateOnAxis(r.axis, r.spin * dt);
      const p = THREE.MathUtils.clamp(1 - (r.y - r.groundY - r.r) / r.H, 0, 1);
      r.shadow.material.uniforms.uOpacity.value = Math.min(1, 0.3 + 0.75 * p * p) * Math.min(1, (r.y0 - r.y) * 2 + 0.3);
      const ss = r.r * (2.8 - 0.9 * p);
      r.shadow.scale.set(ss, 1, ss * 1.9);

      if (!hit && hitTest && hitTest(r)) hit = r;

      if (r.y - r.r * 0.8 <= r.groundY) {
        this.effects.impact(r.x, r.groundY, 0, r.r);
        if (this.onImpact) this.onImpact(r);
        this.active.splice(i, 1);
        this.release(r);
      }
    }
    return hit;
  }

  spawnOne(ctx, d) {
    const b = ctx.bound;
    const boulder = Math.random() < d.boulder;
    const radius = boulder ? 0.95 + Math.random() * 0.3 : 0.3 + Math.pow(Math.random(), 1.6) * 0.55;
    const fallTime = d.fallTime * (0.82 + Math.random() * 0.36) * (boulder ? 1.15 : 1);
    let x;
    if (Math.random() < d.aimed) {
      x = ctx.foxX + ctx.foxVx * fallTime * 0.55 + (Math.random() - 0.5) * 1.8;
    } else {
      x = (Math.random() * 2 - 1) * (b - 0.2);
    }
    x = THREE.MathUtils.clamp(x, -b + 0.3, b - 0.3);
    // avoid stacking two rocks on top of each other
    for (let k = 0; k < 4; k++) {
      const clash = this.active.some((o) => Math.abs(o.x - x) < (o.r + radius) * 1.1 && Math.abs(o.y - (ctx.topY + radius)) < 2.5);
      if (!clash) break;
      x = THREE.MathUtils.clamp((Math.random() * 2 - 1) * b, -b + 0.3, b - 0.3);
    }
    this.spawn({ x, radius, fallTime, topY: ctx.topY, groundY: ctx.groundAt(x) });
  }

  /** Remove every rock with a small puff (used on restart). */
  clear() {
    for (const r of this.active) {
      this.effects.puff(r.x, Math.max(r.groundY, r.y - r.r), 0, { count: 6, size: r.r * 0.8, up: 0.4, alpha: 0.35 });
      this.release(r);
    }
    this.active.length = 0;
    this.spawnClock = 0.8;
  }
}
