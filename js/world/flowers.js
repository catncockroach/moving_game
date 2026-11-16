import * as THREE from 'three';
import { patchMaterial, GLSL_NOISE, GLSL_WIND } from '../core/shared.js';
import { GLSL_PLANT, GRASS_Z, halfWidthAtZ } from './grass.js';
import { heightAt, pathCenter, pathHalfWidth, noise2 } from './terrain.js';
import { flowerAtlasTexture } from '../core/textures.js';

/** Little flowers scattered in patches; stems + heads share the same wind bend. */
export function createFlowers(theme, count) {
  const bases = [];
  let guard = 0;
  while (bases.length < count && guard++ < count * 60) {
    const z = GRASS_Z[0] + 1.5 + Math.random() * (GRASS_Z[1] - GRASS_Z[0] - 2);
    const x = (Math.random() * 2 - 1) * halfWidthAtZ(z) * 0.92;
    const dz = z - pathCenter(x);
    if (Math.abs(dz) < pathHalfWidth(x) * 1.35) continue;
    const patch = noise2(x * 0.18 + 40, z * 0.18) * 0.5 + 0.5;
    if (Math.random() > Math.pow(patch, 2.2) * 1.6) continue;
    const kind = Math.floor((noise2(x * 0.1 + 70, z * 0.1) * 0.5 + 0.5) * 4.0 + Math.random() * 1.2) % 4;
    const near = dz > 0 ? Math.min(1, 0.45 + (dz - 1.3) * 0.08) : 1;
    const h = (0.22 + Math.random() * 0.26) * near;
    bases.push({ x, y: heightAt(x, z) - 0.02, z, h, kind, yaw: Math.random() * Math.PI * 2, s: 0.75 + Math.random() * 0.5 });
  }
  const n = bases.length;

  const aFlower = new Float32Array(n * 4);
  const aAtlas = new Float32Array(n * 2);
  const m = new THREE.Matrix4();
  bases.forEach((b, i) => {
    aFlower.set([b.h, b.yaw, b.s, Math.random()], i * 4);
    aAtlas.set([(b.kind % 2) * 0.5, Math.floor(b.kind / 2) * 0.5], i * 2);
  });

  const vertexCommon = `
    attribute vec4 aFlower;
    ${GLSL_NOISE}
    ${GLSL_WIND}
    ${GLSL_PLANT}`;

  // ---- stems
  const stemGeo = new THREE.PlaneGeometry(0.014, 1, 1, 3);
  stemGeo.translate(0, 0.5, 0);
  const stemMat = patchMaterial(new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.9 }), 'flower-stem', (shader) => {
    shader.uniforms.uStem = { value: theme.cur.grassBase };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + vertexCommon)
      .replace('#include <begin_vertex>', /* glsl */`
        vec3 transformed = position;
        transformed.y *= aFlower.x;
        float c = cos(aFlower.y), s = sin(aFlower.y);
        transformed.xz = vec2(transformed.x * c, -transformed.x * s);
        vec3 fBase = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        transformed.xz += plantBend(fBase, position.y, aFlower.x, 0.3);
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uStem;')
      .replace('#include <color_fragment>', 'diffuseColor.rgb = uStem * 1.15;');
  });
  const stems = new THREE.InstancedMesh(stemGeo, stemMat, n);

  // ---- heads (a small disc tilted towards the sky and the camera)
  const headGeo = new THREE.PlaneGeometry(1, 1);
  headGeo.rotateX(-Math.PI / 2 + 0.55);
  const headMat = patchMaterial(new THREE.MeshStandardMaterial({
    map: flowerAtlasTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.7,
  }), 'flower-head', (shader) => {
    shader.uniforms.uGlow = { value: 0 };
    headMat.userData.shader = shader;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aAtlas;\n' + vertexCommon)
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = vMapUv * 0.5 + aAtlas;')
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.25);')
      .replace('#include <begin_vertex>', /* glsl */`
        vec3 transformed = position * (0.11 * aFlower.z);
        transformed.y += aFlower.x;
        vec3 fBase = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        transformed.xz += plantBend(fBase, 1.0, aFlower.x, 0.3);
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uGlow;');
  });
  const heads = new THREE.InstancedMesh(headGeo, headMat, n);

  bases.forEach((b, i) => {
    m.makeTranslation(b.x, b.y, b.z);
    stems.setMatrixAt(i, m);
    heads.setMatrixAt(i, m);
  });
  for (const mesh of [stems, heads]) {
    mesh.geometry.setAttribute('aFlower', new THREE.InstancedBufferAttribute(aFlower, 4));
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
  }
  heads.geometry.setAttribute('aAtlas', new THREE.InstancedBufferAttribute(aAtlas, 2));

  const group = new THREE.Group();
  group.add(stems, heads);
  group.name = 'flowers';
  return {
    group,
    update(theme) {
      const s = headMat.userData.shader;
      if (s) s.uniforms.uGlow.value = theme.cur.flowerGlow * 0.35;
    },
  };
}
