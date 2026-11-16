import * as THREE from 'three';

/**
 * Uniforms shared by every custom shader in the scene.
 * They are passed by reference, so updating `.value` once updates all materials.
 */
export const shared = {
  uTime: { value: 0 },
  uWindDir: { value: new THREE.Vector2(1, 0.22).normalize() },
  uWindStrength: { value: 1 },
  // xyz = player position, w = how strongly the player pushes the grass
  uPlayer: { value: new THREE.Vector4(0, 0, 0, 1) },
  // direction towards the sun (world space) and in view space
  uSunDir: { value: new THREE.Vector3(-0.6, 0.65, -0.3).normalize() },
  uSunView: { value: new THREE.Vector3(0, 1, 0) },
  uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
};

/** Returns a material whose shader gets the shared uniforms and a patch function. */
export function patchMaterial(material, key, patch) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared);
    patch(shader);
  };
  material.customProgramCacheKey = () => key;
  return material;
}

export const GLSL_NOISE = /* glsl */`
vec3 _m289(vec3 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 _m289(vec2 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 _perm(vec3 x){ return _m289(((x * 34.0) + 1.0) * x); }
float snoise(vec2 v){
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = _m289(i);
  vec3 p = _perm(_perm(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
float fbm2(vec2 p){
  float f = 0.0; float a = 0.5;
  for (int i = 0; i < 4; i++) { f += a * snoise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
  return f;
}
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3){ p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise3(vec3 p){
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y),
    f.z);
}
`;

/** Wind field: slow travelling gusts + gentle sway. Returns an xz displacement direction*strength. */
export const GLSL_WIND = /* glsl */`
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWindStrength;
vec2 windField(vec2 p){
  float gust = snoise(p * 0.045 - uWindDir * uTime * 0.32) * 0.5 + 0.5;
  gust = gust * gust;
  float sway = sin(uTime * 1.35 + dot(p, vec2(0.23, 0.17))) * 0.32
             + sin(uTime * 2.37 + p.x * 0.51 - p.y * 0.3) * 0.14;
  return uWindDir * (0.3 + gust * 1.45 + sway) * uWindStrength;
}
`;
