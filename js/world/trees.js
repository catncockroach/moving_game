import * as THREE from 'three';
import { patchMaterial, GLSL_NOISE, GLSL_WIND } from '../core/shared.js';
import { heightAt, noise2 } from './terrain.js';
import { leafClusterTexture, seeded } from '../core/textures.js';

/*
 * Stylised "fluffy" trees: tapered trunks/branches + canopies made of camera-facing,
 * alpha-tested leaf-cluster cards with spherical normals, wind sway, leaf flutter,
 * light transmission and proper shadow casting.
 */

const GLSL_LEAF_PALETTE = /* glsl */`
uniform vec3 uLeaf0, uLeaf1, uLeaf2, uLeaf3;
vec3 leafColor(float v){
  return v < 0.5 ? uLeaf0 : (v < 1.5 ? uLeaf1 : (v < 2.5 ? uLeaf2 : uLeaf3));
}
`;

function leafUniforms(theme) {
  const c = theme.cur;
  return {
    uLeaf0: { value: c.leaf0 }, uLeaf1: { value: c.leaf1 },
    uLeaf2: { value: c.leaf2 }, uLeaf3: { value: c.leaf3 },
    uBark: { value: c.bark },
  };
}

class Builder {
  constructor() {
    this.trunk = { pos: [], nrm: [], shade: [], tree: [], idx: [] };
    this.cards = { pos: [], nrm: [], uv: [], corner: [], card: [], tree: [], idx: [] };
    this.cores = { pos: [], nrm: [], card: [], tree: [], idx: [] };
  }

  /** Tapered tube along a curve. */
  tube(points, r0, r1, base, H, rand, radial = 7, segs = 8) {
    const t = this.trunk;
    const curve = new THREE.CatmullRomCurve3(points);
    const frames = curve.computeFrenetFrames(segs, false);
    const start = t.pos.length / 3;
    const p = new THREE.Vector3(), n = new THREE.Vector3();
    for (let i = 0; i <= segs; i++) {
      const u = i / segs;
      curve.getPointAt(u, p);
      const r = THREE.MathUtils.lerp(r0, r1, Math.pow(u, 0.8)) * (i === 0 ? 1.35 : 1);
      for (let k = 0; k <= radial; k++) {
        const a = (k / radial) * Math.PI * 2;
        n.copy(frames.normals[i]).multiplyScalar(Math.cos(a)).addScaledVector(frames.binormals[i], Math.sin(a)).normalize();
        t.pos.push(p.x + n.x * r, p.y + n.y * r, p.z + n.z * r);
        t.nrm.push(n.x, n.y, n.z);
        const hN = Math.max(0, (p.y - base.y) / H);
        t.shade.push(0.6 + 0.4 * Math.min(1, hN * 2.5));
        t.tree.push(base.x, base.z, Math.pow(hN, 1.5) * H / 6, rand);
      }
    }
    for (let i = 0; i < segs; i++) {
      for (let k = 0; k < radial; k++) {
        const a = start + i * (radial + 1) + k, b = a + radial + 1;
        t.idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }

  /** Canopy blob = solid core + many leaf cards. */
  blob(center, r, crown, base, H, variant, rand, rng, density = 1) {
    const cd = this.cards;
    const count = Math.ceil(r * r * 26 * density);
    const sizeBase = r * 0.5 + 0.28;
    const v = new THREE.Vector3(), nrm = new THREE.Vector3(), tmp = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      // random point inside the blob, biased towards the surface, slightly flattened at the bottom
      v.set(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1);
      if (v.lengthSq() > 1 || v.lengthSq() < 0.01) { i--; continue; }
      v.normalize().multiplyScalar(r * (0.55 + 0.45 * Math.sqrt(rng())));
      if (v.y < 0) v.y *= 0.7;
      const p = tmp.copy(center).add(v);
      nrm.copy(p).sub(crown).normalize().multiplyScalar(0.7).add(v.clone().normalize().multiplyScalar(0.3)).normalize();
      const dist = v.length() / r;
      let shade = (0.55 + 0.45 * (0.5 + 0.5 * nrm.y)) * (0.6 + 0.4 * dist) * (0.88 + rng() * 0.24);
      const size = sizeBase * (0.8 + rng() * 0.45);
      const rot = rng() * Math.PI * 2;
      const hN = Math.max(0, (p.y - base.y) / H);
      const bend = Math.pow(Math.min(hN, 1.3), 1.5) * H / 6;
      const vi = Math.random() < 0.12 ? (variant + 1) % 4 : variant;
      const start = cd.pos.length / 3;
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      for (const [cx, cy] of corners) {
        cd.pos.push(p.x, p.y, p.z);
        cd.nrm.push(nrm.x, nrm.y, nrm.z);
        cd.uv.push(cx * 0.5 + 0.5, cy * 0.5 + 0.5);
        cd.corner.push(cx, cy);
        cd.card.push(size, rot, shade, vi);
        cd.tree.push(base.x, base.z, bend, rand + i * 0.013);
      }
      cd.idx.push(start, start + 1, start + 2, start, start + 2, start + 3);
    }
    // solid core so the canopy never looks see-through
    const core = new THREE.IcosahedronGeometry(r * 0.72, 2);
    const cp = core.attributes.position;
    const co = this.cores;
    const startC = co.pos.length / 3;
    for (let i = 0; i < cp.count; i++) {
      v.fromBufferAttribute(cp, i);
      const k = 1 + noise2(v.x * 1.7 + center.x, v.y * 1.7 + v.z * 1.3 + center.z) * 0.22;
      v.multiplyScalar(k);
      if (v.y < 0) v.y *= 0.75;
      const p = tmp.copy(center).add(v);
      nrm.copy(p).sub(crown).normalize();
      co.pos.push(p.x, p.y, p.z);
      co.nrm.push(nrm.x, nrm.y, nrm.z);
      const hN = Math.max(0, (p.y - base.y) / H);
      co.card.push(0, 0, 0.42 + 0.18 * (0.5 + 0.5 * nrm.y), variant);
      co.tree.push(base.x, base.z, Math.pow(Math.min(hN, 1.3), 1.5) * H / 6, rand);
      co.idx.push(startC + i);
    }
    core.dispose();
  }

  broadleaf(x, z, S, rng, variant, opts = {}) {
    const y0 = heightAt(x, z);
    const base = new THREE.Vector3(x, y0, z);
    const H = (4.4 + rng() * 1.8) * S;
    const lean = (rng() - 0.5) * 0.5 * S;
    const leanZ = (rng() - 0.5) * 0.3 * S;
    const rand = rng();
    const crown = new THREE.Vector3(x + lean, y0 + H * 0.92, z + leanZ);
    const pts = [
      new THREE.Vector3(x, y0 - 0.3, z),
      new THREE.Vector3(x + lean * 0.15, y0 + H * 0.3, z + leanZ * 0.2),
      new THREE.Vector3(x + lean * 0.6, y0 + H * 0.62, z + leanZ * 0.6),
      new THREE.Vector3(x + lean, y0 + H * 0.88, z + leanZ),
    ];
    this.tube(pts, 0.24 * S * (opts.trunk || 1), 0.09 * S, base, H, rand, 8, 10);
    const RC = (1.9 + rng() * 0.7) * S * (opts.crown || 1);
    this.blob(crown.clone().add(new THREE.Vector3(0, RC * 0.15, 0)), RC * 0.62, crown, base, H, variant, rand, rng);
    const branches = 3 + Math.floor(rng() * 3);
    const trunkCurve = new THREE.CatmullRomCurve3(pts);
    for (let b = 0; b < branches; b++) {
      const a = (b / branches) * Math.PI * 2 + rng() * 0.8;
      const from = trunkCurve.getPointAt(0.5 + rng() * 0.32);
      const dir = new THREE.Vector3(Math.cos(a), 0.55 + rng() * 0.6, Math.sin(a) * 0.75).normalize();
      const end = crown.clone().addScaledVector(dir, RC * (0.62 + rng() * 0.25));
      end.y -= RC * 0.18;
      const mid = from.clone().lerp(end, 0.5);
      mid.y -= 0.25 * S;
      this.tube([from, mid, end], 0.1 * S, 0.035 * S, base, H, rand, 5, 5);
      this.blob(end, RC * (0.4 + rng() * 0.16), crown, base, H, variant, rand, rng);
    }
  }

  bush(x, z, S, rng, variant) {
    const y0 = heightAt(x, z);
    const base = new THREE.Vector3(x, y0, z);
    const rand = rng();
    const H = 1.6 * S;
    const blobs = 2 + Math.floor(rng() * 3);
    const crown = new THREE.Vector3(x, y0 + 0.3 * S, z);
    for (let i = 0; i < blobs; i++) {
      const r = (0.48 + rng() * 0.38) * S;
      const c = new THREE.Vector3(x + (rng() - 0.5) * 1.3 * S, y0 + r * 0.62, z + (rng() - 0.5) * 0.7 * S);
      this.blob(c, r, crown, base, H, variant, rand, rng, 1.25);
    }
  }

  geometry(kind) {
    const d = this[kind];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(d.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(d.nrm, 3));
    g.setAttribute('aTree', new THREE.Float32BufferAttribute(d.tree, 4));
    if (kind === 'trunk') g.setAttribute('aShade', new THREE.Float32BufferAttribute(d.shade, 1));
    if (kind === 'cards') {
      g.setAttribute('uv', new THREE.Float32BufferAttribute(d.uv, 2));
      g.setAttribute('aCorner', new THREE.Float32BufferAttribute(d.corner, 2));
    }
    if (kind !== 'trunk') g.setAttribute('aCard', new THREE.Float32BufferAttribute(d.card, 4));
    g.setIndex(d.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/* ---------------- shader patches ---------------- */

const SWAY = /* glsl */`
  vec2 tSway = windField(aTree.xy) * 0.13 * aTree.z;
  transformed.xz += tSway;
  transformed.y -= dot(tSway, tSway) * 0.3;
`;

const CARD_EXPAND = /* glsl */`
  vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
  float cR = cos(aCard.y), sR = sin(aCard.y);
  vec2 cOff = mat2(cR, sR, -sR, cR) * aCorner * aCard.x;
  mvPosition.xy += cOff;
  gl_Position = projectionMatrix * mvPosition;
`;

const FLUTTER = /* glsl */`
  transformed.xz += vec2(sin(uTime * 2.7 + aTree.w * 31.0), cos(uTime * 2.3 + aTree.w * 17.0)) * 0.035 * aTree.z;
  transformed.y += sin(uTime * 3.1 + aTree.w * 23.0) * 0.025 * aTree.z;
`;

function cardsMaterials(theme, tex, uniforms) {
  const mat = patchMaterial(new THREE.MeshStandardMaterial({
    map: tex, alphaTest: 0.5, roughness: 0.78, metalness: 0, side: THREE.DoubleSide,
  }), 'leaf-cards', (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aTree; attribute vec4 aCard; attribute vec2 aCorner;
        varying float vShade; varying float vVariant;
        uniform vec3 uSunDir;
        ${GLSL_NOISE}
        ${GLSL_WIND}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${SWAY}\n${FLUTTER}\nvShade = aCard.z; vVariant = aCard.w;`)
      .replace('#include <project_vertex>', CARD_EXPAND)
      .replace('#include <worldpos_vertex>', /* glsl */`
        vec4 worldPosition = modelMatrix * vec4(transformed, 1.0);
        worldPosition.xyz += (vec4(cOff, 0.0, 0.0) * viewMatrix).xyz + uSunDir * 0.35;
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vShade; varying float vVariant;
        uniform vec3 uSunView; uniform vec3 uSunColor;
        ${GLSL_LEAF_PALETTE}`)
      .replace('#include <color_fragment>', /* glsl */`
        vec3 lc = leafColor(vVariant);
        float lum = diffuseColor.r;
        diffuseColor.rgb = lc * (0.45 + 0.75 * lum) * vShade;
      `)
      .replace('#include <normal_fragment_begin>',
        THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''))
      .replace('#include <emissivemap_fragment>', /* glsl */`
        #include <emissivemap_fragment>
        vec3 Vd = normalize(vViewPosition);
        float trans = pow(max(dot(-Vd, uSunView), 0.0), 3.0);
        totalEmissiveRadiance += lc * vShade * uSunColor * (0.06 + trans * 0.45);
      `);
  });

  const depth = patchMaterial(new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: 0.5, side: THREE.DoubleSide,
  }), 'leaf-cards-depth', (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aTree; attribute vec4 aCard; attribute vec2 aCorner;
        ${GLSL_NOISE}
        ${GLSL_WIND}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${SWAY}\n${FLUTTER}`)
      .replace('#include <project_vertex>', CARD_EXPAND);
  });
  return { mat, depth };
}

function solidMaterials(key, uniforms, { vHead = '', vBody = '', fHead = '', fColor }) {
  const mat = patchMaterial(new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 }), key, (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aTree;
        varying vec3 vWPos2;
        ${vHead}
        ${GLSL_NOISE}
        ${GLSL_WIND}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${SWAY}\nvWPos2 = transformed;\n${vBody}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos2;
        uniform vec3 uBark;
        ${fHead}
        ${GLSL_NOISE}
        ${GLSL_LEAF_PALETTE}`)
      .replace('#include <color_fragment>', fColor);
  });
  const depth = patchMaterial(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), key + '-depth', (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec4 aTree;\n${GLSL_NOISE}\n${GLSL_WIND}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${SWAY}`);
  });
  return { mat, depth };
}

/* ---------------- public API ---------------- */

export function createTrees(theme, { cardDensity = 1 } = {}) {
  const rng = seeded(1337);
  const b = new Builder();

  // framing trees (left and right, a little behind the path)
  const spots = [[-11.8, -3.6], [12.4, -3.2]];
  b.broadleaf(-11.8, -3.6, 1.55, rng, 0, { crown: 1.1 });
  b.broadleaf(12.4, -3.2, 1.6, rng, 2, { crown: 1.12 });

  const tryPlace = (x, z, minD) => {
    for (const s of spots) if (Math.hypot(s[0] - x, s[1] - z) < minD) return false;
    spots.push([x, z]);
    return true;
  };

  // two loose groves on the sides, leaving an open meadow in the middle of the view
  let guard = 0, placed = 0;
  while (placed < 12 && guard++ < 4000) {
    const side = placed % 2 ? 1 : -1;
    const z = -5 - rng() * 11;
    const x = side * (7 + rng() * (14 + (-z) * 0.6));
    if (!tryPlace(x, z, 5.2 + (-z) * 0.1)) continue;
    const S = 0.9 + rng() * 0.4 + (-z - 5) * 0.02;
    b.broadleaf(x, z, S, rng, Math.floor(rng() * 4));
    placed++;
  }
  // a lone tree in the meadow as a focal point
  spots.push([4.5, -21]);
  b.broadleaf(4.5, -21, 1.25, rng, 3, { crown: 1.05 });

  // bushes along the back edge of the path, with gaps
  guard = 0;
  let bushes = 0;
  while (bushes < 12 && guard++ < 4000) {
    const z = -2.5 - rng() * 1.8;
    const x = (rng() * 2 - 1) * 22;
    if (!tryPlace(x, z, 3.4)) continue;
    b.bush(x, z, 0.75 + rng() * 0.55, rng, Math.floor(rng() * 4));
    bushes++;
  }
  // a few under the groves
  guard = 0;
  while (bushes < 18 && guard++ < 4000) {
    const z = -6 - rng() * 6;
    const x = (rng() < 0.5 ? -1 : 1) * (8 + rng() * 14);
    if (!tryPlace(x, z, 2.6)) continue;
    b.bush(x, z, 0.8 + rng() * 0.5, rng, Math.floor(rng() * 4));
    bushes++;
  }

  const uniforms = leafUniforms(theme);
  const tex = leafClusterTexture();

  const trunkGeo = b.geometry('trunk');
  const trunkM = solidMaterials('bark', uniforms, {
    vHead: 'attribute float aShade; varying float vShadeT;',
    vBody: 'vShadeT = aShade;',
    fHead: 'varying float vShadeT;',
    fColor: /* glsl */`
      float streak = snoise(vec2((vWPos2.x + vWPos2.z) * 9.0, vWPos2.y * 1.3)) * 0.5 + 0.5;
      float knots = smoothstep(0.75, 0.95, snoise(vWPos2.xy * 3.0 + vWPos2.z));
      diffuseColor.rgb = uBark * vShadeT * (0.78 + 0.32 * streak) * (1.0 - knots * 0.25);
    `,
  });
  const trunks = new THREE.Mesh(trunkGeo, trunkM.mat);
  trunks.customDepthMaterial = trunkM.depth;
  trunks.castShadow = true;
  trunks.receiveShadow = true;

  const coreGeo = b.geometry('cores');
  const coreM = solidMaterials('leaf-core', uniforms, {
    vHead: 'attribute vec4 aCard; varying float vVar; varying float vSh;',
    vBody: 'vVar = aCard.w; vSh = aCard.z;',
    fHead: 'varying float vVar; varying float vSh;',
    fColor: /* glsl */`
      diffuseColor.rgb = leafColor(vVar) * vSh * (0.85 + 0.25 * snoise(vWPos2.xy * 2.0 + vWPos2.z));
    `,
  });
  const cores = new THREE.Mesh(coreGeo, coreM.mat);
  cores.customDepthMaterial = coreM.depth;
  cores.castShadow = true;
  cores.receiveShadow = true;

  const cardGeo = b.geometry('cards');
  const cardM = cardsMaterials(theme, tex, uniforms);
  const cards = new THREE.Mesh(cardGeo, cardM.mat);
  cards.customDepthMaterial = cardM.depth;
  cards.castShadow = true;
  cards.receiveShadow = true;
  cards.frustumCulled = false;

  const group = new THREE.Group();
  group.add(trunks, cores, cards);
  group.name = 'trees';

  // canopy spots for falling leaves
  const canopies = spots.slice(0, 22).map(([x, z]) => new THREE.Vector3(x, heightAt(x, z) + 4.5, z));
  return { group, canopies, uniforms };
}

/** Distant forest on the hills: instanced low-poly broadleaf and pine trees. */
export function createFarForest(theme, count, uniforms) {
  const rng = seeded(4242);

  const makeBroad = () => {
    const crown = new THREE.IcosahedronGeometry(1, 1);
    const p = crown.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const k = 1 + noise2(v.x * 2.1, v.y * 2.1 + v.z) * 0.25;
      p.setXYZ(i, v.x * k, v.y * k * 0.9 + 1.55, v.z * k);
    }
    crown.computeVertexNormals();
    const trunk = new THREE.CylinderGeometry(0.08, 0.14, 1.0, 5);
    trunk.translate(0, 0.5, 0);
    return [crown, trunk];
  };
  const makePine = () => {
    const parts = [];
    for (let i = 0; i < 3; i++) {
      const c = new THREE.ConeGeometry(0.95 - i * 0.24, 1.25, 7);
      c.translate(0, 1.1 + i * 0.7, 0);
      parts.push(c);
    }
    const trunk = new THREE.CylinderGeometry(0.07, 0.12, 1.0, 5);
    trunk.translate(0, 0.5, 0);
    return [...parts, trunk];
  };

  const toGeo = (parts) => {
    // non-indexed merge with an "is trunk" flag in aCard.y
    const pos = [], nrm = [], flag = [];
    parts.forEach((g, gi) => {
      const ng = g.index ? g.toNonIndexed() : g;
      const isTrunk = gi === parts.length - 1 ? 1 : 0;
      pos.push(...ng.attributes.position.array);
      nrm.push(...ng.attributes.normal.array);
      for (let i = 0; i < ng.attributes.position.count; i++) {
        const y = ng.attributes.position.getY(i);
        flag.push(isTrunk, Math.min(1, y / 3.2));
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(flag, 2));
    return g;
  };

  const kinds = [toGeo(makeBroad()), toGeo(makePine())];
  const group = new THREE.Group();
  kinds.forEach((geo, kind) => {
    const n = Math.floor(count * (kind === 0 ? 0.68 : 0.32));
    const mesh = new THREE.InstancedMesh(geo, null, n);
    const aVar = new Float32Array(n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    let i = 0, guard = 0;
    while (i < n && guard++ < n * 50) {
      const z = -34 - Math.pow(rng(), 0.7) * 110;
      const halfW = (18 - z) * 0.36 * 2.5 + 6;
      const x = (rng() * 2 - 1) * halfW;
      // distinct forest patches with open clearings, sparser in the centre of the view
      const forest = noise2(x * 0.035 + 3.0, z * 0.05) * 0.5 + 0.5;
      const centre = THREE.MathUtils.smoothstep(Math.abs(x) / (halfW * 0.5), 0.15, 0.6);
      if (rng() > (forest * 2.2 - 0.85) * (0.35 + 0.65 * centre)) continue;
      const sc = (1.4 + rng() * 1.3) * (kind ? 1.1 : 1) * (1 + (-z - 34) * 0.006);
      p.set(x, heightAt(x, z) - 0.2, z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI * 2);
      s.set(sc * (0.85 + rng() * 0.3), sc * (0.85 + rng() * 0.35), sc * (0.85 + rng() * 0.3));
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
      aVar[i] = kind ? (rng() < 0.6 ? 2 : 0) : Math.floor(rng() * 4);
      i++;
    }
    mesh.count = i;
    geo.setAttribute('aVar', new THREE.InstancedBufferAttribute(aVar, 1));
    mesh.material = patchMaterial(new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: kind === 1 }), 'far-tree-' + kind, (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aVar; attribute vec2 aPart; varying float vVarF; varying vec2 vPart;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvVarF = aVar; vPart = aPart;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying float vVarF; varying vec2 vPart;\nuniform vec3 uBark;\n${GLSL_LEAF_PALETTE}`)
        .replace('#include <color_fragment>', /* glsl */`
          vec3 fc = leafColor(vVarF) * (0.55 + 0.5 * vPart.y);
          diffuseColor.rgb = mix(fc, uBark * 0.8, vPart.x);
        `);
    });
    mesh.frustumCulled = false;
    mesh.receiveShadow = false;
    group.add(mesh);
  });
  group.name = 'far-forest';
  return group;
}
