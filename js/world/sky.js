import * as THREE from 'three';
import { shared, GLSL_NOISE } from '../core/shared.js';

/** Procedural sky dome: gradient, sun / moon, drifting fbm clouds and stars. */
export function createSky(theme) {
  const c = theme.cur;
  const uniforms = {
    uTime: shared.uTime,
    uSunDir: shared.uSunDir,
    uWindDir: shared.uWindDir,
    uTop: { value: c.skyTop },
    uHorizon: { value: c.skyHorizon },
    uSunDisk: { value: c.sunDisk },
    uSunGlow: { value: c.sunGlow },
    uCloud: { value: c.cloud },
    uCloudShade: { value: c.cloudShade },
    uCloudCover: { value: c.cloudCover },
    uStars: { value: c.stars },
    uSunDiskVis: { value: c.sunDiskVis },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform vec3 uSunDir;
      uniform vec2 uWindDir;
      uniform vec3 uTop, uHorizon, uSunDisk, uSunGlow, uCloud, uCloudShade;
      uniform float uCloudCover, uStars, uSunDiskVis;
      varying vec3 vDir;
      ${GLSL_NOISE}
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        float t = pow(clamp(h, 0.0, 1.0), 0.5);
        vec3 col = mix(uHorizon, uTop, t);

        float sd = max(dot(d, uSunDir), 0.0);
        col += uSunGlow * (pow(sd, 6.0) * 0.28 + pow(sd, 48.0) * 0.55);
        // soft bright band just above the horizon
        col = mix(col, uHorizon * 1.04, (1.0 - smoothstep(-0.02, 0.16, h)) * 0.35);

        // stars
        if (uStars > 0.001) {
          vec3 sp = d * 160.0;
          vec3 cell = floor(sp);
          float r = hash13(cell);
          float dist = length(fract(sp) - 0.5);
          float size = 0.07 + 0.1 * fract(r * 37.0);
          float star = step(0.986, r) * (1.0 - smoothstep(0.0, size, dist)) * smoothstep(0.02, 0.25, h);
          float tw = 0.65 + 0.35 * sin(uTime * (1.5 + 2.0 * fract(r * 91.0)) + r * 80.0);
          col += vec3(0.9, 0.95, 1.0) * star * tw * uStars * 3.0;
        }

        // clouds on a virtual plane
        float cloudOcc = 0.0;
        if (h > -0.02) {
          float hh = max(h, 0.0);
          vec2 uv = d.xz / (hh + 0.16) * 0.9;
          uv += uWindDir * uTime * 0.012;
          float n = fbm2(uv * 0.85) * 0.5 + 0.5;
          float n2 = fbm2(uv * 2.4 + 7.0) * 0.5 + 0.5;
          float density = n * 0.82 + n2 * 0.26;
          float cov = 1.0 - uCloudCover;
          float cl = smoothstep(cov, cov + 0.3, density);
          cl *= smoothstep(0.0, 0.2, hh) * (1.0 - smoothstep(0.7, 1.0, hh) * 0.6);
          float lit = smoothstep(0.25, 0.85, n2) * 0.6 + 0.4 * smoothstep(cov, cov + 0.6, density);
          vec3 cc = mix(uCloudShade, uCloud, lit);
          cc += uSunGlow * pow(sd, 5.0) * 0.55;
          col = mix(col, cc, cl * 0.9);
          cloudOcc = cl;
        }

        float disk = smoothstep(0.99925, 0.99962, dot(d, uSunDir));
        col += uSunDisk * disk * 7.0 * uSunDiskVis * (1.0 - cloudOcc * 0.9);

        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  mesh.name = 'sky';

  return {
    mesh,
    material,
    update(theme) {
      const cur = theme.cur;
      uniforms.uCloudCover.value = cur.cloudCover;
      uniforms.uStars.value = cur.stars;
      uniforms.uSunDiskVis.value = cur.sunDiskVis;
    },
  };
}
