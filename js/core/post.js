import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/** Final grading in display space: saturation / contrast / tint, vignette, game-over desaturation, grain. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSaturation: { value: 1.1 },
    uContrast: { value: 1.05 },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uDead: { value: 0 },
    uVignette: { value: 0.32 },
    uTime: { value: 0 },
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uSaturation, uContrast, uDead, uVignette, uTime, uAspect;
    uniform vec3 uTint;
    varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb * uTint;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation * (1.0 - uDead * 0.7));
      col = (col - 0.5) * uContrast + 0.5;
      col *= 1.0 - uDead * 0.12;
      vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
      float v = smoothstep(0.35, 1.25, length(q) * 1.05);
      col *= 1.0 - v * (uVignette + uDead * 0.25);
      col += (h(vUv * 1000.0 + uTime) - 0.5) * 0.012;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
};

export function createPost(renderer, scene, camera, { samples = 4 } = {}) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    samples: renderer.capabilities.isWebGL2 === false ? 0 : samples,
  });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.25, 0.55, 0.92);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);

  return {
    composer,
    bloom,
    grade,
    setSize(w, h, pr) {
      composer.setPixelRatio(pr);
      composer.setSize(w, h);
      grade.uniforms.uAspect.value = w / h;
    },
    update(theme, dead, t) {
      bloom.strength = theme.cur.bloom;
      grade.uniforms.uSaturation.value = theme.cur.saturation;
      grade.uniforms.uContrast.value = theme.cur.contrast;
      grade.uniforms.uTint.value.copy(theme.cur.tint);
      grade.uniforms.uDead.value = dead;
      grade.uniforms.uTime.value = t % 100;
    },
    render(dt) { composer.render(dt); },
    dispose() { composer.dispose(); rt.dispose(); },
  };
}
