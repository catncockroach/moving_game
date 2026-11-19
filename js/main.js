import * as THREE from 'three';
import { shared } from './core/shared.js';
import { Theme } from './core/theme.js';
import { createPost } from './core/post.js';
import { Audio } from './core/audio.js';
import { UI, Input } from './core/ui.js';
import { createSky } from './world/sky.js';
import { createGround, createRidges, heightAt } from './world/terrain.js';
import { createGrass } from './world/grass.js';
import { createFlowers } from './world/flowers.js';
import { createTrees, createFarForest } from './world/trees.js';
import { createMotes, createButterflies, createBirds, createFallingLeaves } from './world/ambient.js';
import { Fox } from './game/player.js';
import { Rocks } from './game/rocks.js';
import { Effects } from './game/effects.js';

/* ------------------------------------------------------------------ */
/* Quality                                                             */
/* ------------------------------------------------------------------ */
const params = new URLSearchParams(location.search);
const TIERS = [
  { dpr: 1, maxPx: 1.3e6, shadow: 1024, grass: 26000, flowers: 320, far: 360, motes: 70, post: false, samples: 0, butterflies: 2 },
  { dpr: 1.5, maxPx: 2.2e6, shadow: 2048, grass: 50000, flowers: 600, far: 600, motes: 110, post: true, samples: 2, butterflies: 3 },
  { dpr: 2, maxPx: 3.7e6, shadow: 2048, grass: 80000, flowers: 900, far: 820, motes: 150, post: true, samples: 4, butterflies: 4 },
];
function detectTier() {
  const q = params.get('q');
  if (q !== null && TIERS[+q]) return +q;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  if (coarse) return cores >= 8 && mem >= 4 ? 1 : 0;
  return cores >= 4 ? 2 : 1;
}
const tier = TIERS[detectTier()];
const quality = { dprScale: 1, post: tier.post, level: 0 };

/* ------------------------------------------------------------------ */
/* Renderer / scene                                                    */
/* ------------------------------------------------------------------ */
const canvas = document.getElementById('scene');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: !tier.post, powerPreference: 'high-performance', stencil: false });
} catch (e) {
  location.replace('./original/');
  throw e;
}
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = params.get('tm') === 'aces' ? THREE.ACESFilmicToneMapping : THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const theme = new Theme('day');
shared.uSunColor.value = theme.cur.sunColor;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(theme.cur.fog, theme.cur.fogDensity);
scene.fog.color = theme.cur.fog;
scene.background = theme.cur.fog;

const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 1200);

const sun = new THREE.DirectionalLight(theme.cur.sunColor, theme.cur.sunIntensity);
sun.color = theme.cur.sunColor;
sun.castShadow = true;
sun.shadow.mapSize.set(tier.shadow, tier.shadow);
const sc = sun.shadow.camera;
sc.left = -26; sc.right = 26; sc.top = 20; sc.bottom = -20; sc.near = 1; sc.far = 160;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.035;
sun.shadow.radius = 3;
sun.target.position.set(0, 0, -4);
scene.add(sun, sun.target);

const hemi = new THREE.HemisphereLight(theme.cur.hemiSky, theme.cur.hemiGround, theme.cur.hemiIntensity);
hemi.color = theme.cur.hemiSky;
hemi.groundColor = theme.cur.hemiGround;
scene.add(hemi);

/* ------------------------------------------------------------------ */
/* World                                                               */
/* ------------------------------------------------------------------ */
const ui = new UI();
const input = new Input(canvas);
const audio = new Audio();
ui.setMuted(audio.muted);
let best = 0;
try { best = Number(localStorage.getItem('mg-best')) || 0; } catch (e) { /* ignore */ }
ui.setBest(best);

const progress = { world: 0, fox: 0 };
const showProgress = () => ui.setProgress(progress.world * 0.6 + progress.fox * 0.4);
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

const sky = createSky(theme);
scene.add(sky.mesh);

let ground, ridges, grass, flowers, trees, farForest, motes, butterflies, birds, leaves, effects, rocks;
const fox = new Fox();
scene.add(fox.root);

async function buildWorld() {
  ground = createGround(theme); scene.add(ground);
  ridges = createRidges(theme); scene.add(ridges.group);
  progress.world = 0.2; showProgress(); await nextFrame();
  grass = createGrass(theme, tier.grass); scene.add(grass);
  progress.world = 0.45; showProgress(); await nextFrame();
  flowers = createFlowers(theme, tier.flowers); scene.add(flowers.group);
  trees = createTrees(theme); scene.add(trees.group);
  farForest = createFarForest(theme, tier.far, trees.uniforms); scene.add(farForest);
  progress.world = 0.75; showProgress(); await nextFrame();
  motes = createMotes(theme, tier.motes); scene.add(motes.object);
  butterflies = createButterflies(tier.butterflies); scene.add(butterflies.group);
  birds = createBirds(); scene.add(birds.group);
  leaves = createFallingLeaves(theme, trees.canopies, 10); scene.add(leaves.group);
  effects = new Effects(scene, theme);
  rocks = new Rocks(scene, effects, audio);
  rocks.onImpact = (r) => {
    const near = Math.max(0, 1 - Math.abs(r.x - fox.x) / 4);
    game.shake = Math.min(0.3, game.shake + r.r * 0.07 * (0.4 + near));
    audio.thud(r.r, r.x / view.bound, near);
    shared.uImpact.value.set(r.x, 0, time, Math.min(1, 0.4 + r.r * 0.6));
  };
  progress.world = 1; showProgress();
}

/* ------------------------------------------------------------------ */
/* Environment lighting (IBL from the procedural sky)                 */
/* ------------------------------------------------------------------ */
const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
const envSky = new THREE.Mesh(sky.mesh.geometry, sky.material);
envScene.add(envSky);
let envRT = null;
function refreshEnvironment() {
  const old = envRT;
  envRT = pmrem.fromScene(envScene, 0, 0.1, 1000);
  scene.environment = envRT.texture;
  if (old) old.dispose();
}

/* ------------------------------------------------------------------ */
/* Post-processing                                                     */
/* ------------------------------------------------------------------ */
let post = null;
function setPost(enabled) {
  if (post) { post.dispose(); post = null; }
  quality.post = enabled;
  document.body.classList.toggle('css-grade', !enabled);
  if (enabled) {
    try {
      post = createPost(renderer, scene, camera, { samples: tier.samples });
    } catch (e) {
      post = null;
      quality.post = false;
      document.body.classList.add('css-grade');
    }
  }
  resize();
}

/* ------------------------------------------------------------------ */
/* Layout: adapt the camera / play-field to the screen shape           */
/* ------------------------------------------------------------------ */
const view = { bound: 7.8, topY: 8, follow: 0.12, base: new THREE.Vector3(), look: new THREE.Vector3(), halfH: 5, fogScale: 1 };
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  const aspect = w / h;
  const maxDpr = Math.min(window.devicePixelRatio || 1, tier.dpr) * quality.dprScale;
  const dpr = Math.max(0.6, Math.min(maxDpr, Math.sqrt(tier.maxPx / (w * h))));
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  if (post) post.setSize(w, h, dpr);

  camera.aspect = aspect;
  const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  let halfH = 9.6 / aspect;
  halfH = THREE.MathUtils.clamp(halfH, 4.0, 10.5);
  const halfW = halfH * aspect;
  const dist = halfH / tanH;
  view.halfH = halfH;
  // keep the same amount of haze around the play area whatever the camera distance
  view.fogScale = Math.min(1, 15.5 / dist);
  view.bound = THREE.MathUtils.clamp((halfW - 0.55) / (1 + view.follow), 3.2, 8.6);
  view.look.set(0, halfH * 0.42, 0);
  view.base.set(0, view.look.y + halfH * 0.24, dist);
  camera.position.copy(view.base);
  camera.lookAt(view.look);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();

  // top edge of the view on the play plane (z = 0)
  const p = new THREE.Vector3(0, 1, 0.5).unproject(camera).sub(camera.position).normalize();
  const t = -camera.position.z / p.z;
  view.topY = camera.position.y + p.y * t;

  const scale = h * dpr / (2 * tanH);
  if (effects) effects.setViewport(h * dpr, camera.fov);
  if (motes) motes.setScale(scale);
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));

/* ------------------------------------------------------------------ */
/* Game state                                                          */
/* ------------------------------------------------------------------ */
const game = {
  state: 'loading', // loading | ready | playing | dying | over | paused
  elapsed: 0,
  score: 0,
  slowmo: 1,
  dead: 0,
  overAt: 0,
  shake: 0,
  lastFacing: 1,
  dustClock: 0,
};

function startRun() {
  game.state = 'playing';
  game.elapsed = 0;
  game.score = 0;
  weather.next = weatherSpan();
  ui.setScore(0);
  ui.setReady(false);
}

function die(rock) {
  game.state = 'dying';
  game.slowmo = 0.3;
  fox.knockOut(rock.x);
  audio.hit();
  game.shake = Math.min(0.35, game.shake + 0.25);
  const isNew = game.score > best;
  if (isNew) {
    best = game.score;
    try { localStorage.setItem('mg-best', String(best)); } catch (e) { /* ignore */ }
  }
  setTimeout(() => {
    if (game.state !== 'dying') return;
    game.state = 'over';
    game.overAt = performance.now();
    ui.showOver(game.score, best, isNew);
  }, 1100);
}

function restart() {
  if (game.state !== 'over' && game.state !== 'dying') return;
  ui.hideOver();
  rocks.clear();
  fox.revive();
  setWeather(0);
  game.state = 'ready';
  game.score = 0;
  game.elapsed = 0;
  ui.setScore(0);
  ui.setReady(true);
}

function pause(v) {
  if (v && game.state === 'playing') {
    game.state = 'paused';
    ui.showPaused(true);
    input.reset();
  } else if (!v && game.state === 'paused') {
    game.state = 'playing';
    ui.showPaused(false);
  }
}

input.on('any', () => { audio.unlock(); if (game.state === 'paused') pause(false); });
input.on('anykey', () => audio.unlock());
input.on('confirm', () => { audio.unlock(); if (game.state === 'over') restart(); else if (game.state === 'paused') pause(false); });
input.on('pause', () => pause(game.state === 'playing'));
input.on('tap', () => { if (game.state === 'over' && performance.now() - game.overAt > 900) restart(); });
ui.on('restart', () => { audio.unlock(); restart(); });
ui.on('resume', () => pause(false));
ui.on('sound', () => { audio.unlock(); audio.setMuted(!audio.muted); ui.setMuted(audio.muted); });
audio.setMode(theme.name);

/* ------------------------------------------------------------------ */
/* Weather follows the score                                           */
/* Every 8–10 points the scene drifts to the next look (~3.5 s blend), */
/* and it returns to the lush green day when a new run starts.        */
/* ------------------------------------------------------------------ */
const WEATHER = ['day', 'autumn', 'sunset', 'night'];
const weather = { idx: 0, next: 0 };
const weatherSpan = () => 8 + Math.floor(Math.random() * 3); // 8, 9 or 10 points
function setWeather(idx) {
  weather.idx = idx % WEATHER.length;
  theme.set(WEATHER[weather.idx]);
  audio.setMode(WEATHER[weather.idx]);
}
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(true); });
// mobile browsers may drop the GPU context in the background: simply start fresh when it comes back
canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); pause(true); });
canvas.addEventListener('webglcontextrestored', () => location.reload());

/* ------------------------------------------------------------------ */
/* Adaptive quality                                                    */
/* ------------------------------------------------------------------ */
const perf = { acc: 0, frames: 0, warm: 3 };
function adaptQuality(dt) {
  if (params.get('q') !== null) return;
  if (perf.warm > 0) { perf.warm -= dt; return; }
  perf.acc += dt; perf.frames++;
  if (perf.acc < 2) return;
  const avg = perf.acc / perf.frames;
  perf.acc = 0; perf.frames = 0;
  if (avg < 1 / 44) return;
  quality.level++;
  perf.warm = 2; // let the new settings settle before measuring again
  switch (quality.level) {
    case 1: quality.dprScale = 0.8; resize(); break;
    case 2: grass.count = Math.floor(grass.userData.maxCount * 0.6); break;
    case 3: if (quality.post) setPost(false); else quality.dprScale = 0.65; resize(); break;
    case 4: quality.dprScale = 0.6; grass.count = Math.floor(grass.userData.maxCount * 0.35); resize(); break;
    case 5: sun.shadow.mapSize.set(1024, 1024); sun.shadow.map?.dispose(); sun.shadow.map = null; break;
    default: break;
  }
}

/* ------------------------------------------------------------------ */
/* Main loop                                                           */
/* ------------------------------------------------------------------ */
let lastNow = performance.now();
// ?manual: deterministic stepping for automated screenshots / tests
const MANUAL = params.has('manual');
const tmpV = new THREE.Vector3();
let envTimer = 0;
let time = 0;

function frame(renderThis) {
  const now = performance.now();
  const rawDt = MANUAL ? 1 / 60 : Math.min((now - lastNow) / 1000, 1 / 20);
  lastNow = now;
  const realDt = rawDt;
  time += realDt;

  // slow motion on knock-out, eased back to normal
  game.slowmo += (1 - game.slowmo) * (1 - Math.exp(-1.6 * realDt));
  const dt = realDt * (game.state === 'dying' ? game.slowmo : 1);

  // theme transition
  if (theme.update(realDt)) {
    envTimer -= realDt;
    if (envTimer <= 0 || theme.t >= 1) { refreshEnvironment(); envTimer = 0.9; }
  }
  const c = theme.cur;
  sky.update(theme);
  ridges.update(theme);
  flowers.update(theme);
  motes.update(theme, realDt);
  scene.fog.density = c.fogDensity * view.fogScale;
  sun.intensity = c.sunIntensity;
  hemi.intensity = c.hemiIntensity;
  scene.environmentIntensity = c.envIntensity;
  renderer.toneMappingExposure = c.exposure;

  // shared uniforms
  shared.uTime.value = time;
  shared.uSunDir.value.copy(theme.sunDir);
  const gust = 0.5 + 0.5 * Math.sin(time * 0.23) * Math.sin(time * 0.071 + 1.3);
  shared.uWindStrength.value = c.wind * (0.8 + gust * 0.45);
  sun.position.copy(sun.target.position).addScaledVector(theme.sunDir, 70);

  // gameplay
  const playing = game.state === 'playing';
  const dir = (game.state === 'ready' || playing) ? input.dir : 0;
  if (game.state === 'ready' && dir !== 0) startRun();
  if (game.state !== 'paused') {
    fox.update(dt, dir, view.bound);
    if (game.state === 'playing') {
      game.elapsed += dt;
      const s = Math.floor(game.elapsed);
      if (s !== game.score) {
        game.score = s;
        ui.setScore(s);
        if (s > 0 && s % 10 === 0) audio.chime();
        if (s >= weather.next) {
          setWeather(weather.idx + 1);
          weather.next = s + weatherSpan();
        }
      }
    }
    const hitTest = game.state === 'playing' ? (r) => {
      const fy = fox.y + 0.5;
      const dx = THREE.MathUtils.clamp(r.x - fox.x, -0.6, 0.6);
      return Math.hypot(r.x - (fox.x + dx), r.y - fy) < r.r * 0.86 + 0.27;
    } : null;
    const hit = rocks.update(dt, {
      spawning: game.state === 'playing',
      elapsed: game.elapsed,
      foxX: fox.x,
      foxVx: fox.vx,
      bound: view.bound,
      topY: view.topY,
      groundAt: (x) => heightAt(x, 0),
    }, hitTest);
    if (hit) die(hit);

    // little dust kicks while sprinting / turning
    game.dustClock -= dt;
    if (fox.state === 'alive' && fox.speed > 4.2 && game.dustClock <= 0) {
      game.dustClock = 0.11;
      effects.puff(fox.x - fox.facing * 0.5, 0, 0, { count: 1, size: 0.22, up: 0.4, spread: 0.3, life: 0.7, alpha: 0.28 });
    }
    if (fox.facing !== game.lastFacing && fox.speed > 2) {
      effects.puff(fox.x, 0, 0, { count: 4, size: 0.25, up: 0.5, spread: 0.5, life: 0.8, alpha: 0.3 });
    }
    game.lastFacing = fox.facing;
    effects.update(dt, heightAt);
  }

  // ambient life
  butterflies.update(realDt, time);
  birds.update(realDt, time);
  leaves.update(realDt, time, theme);
  audio.update(gust);

  // death desaturation
  const deadTarget = game.state === 'dying' || game.state === 'over' ? 1 : 0;
  game.dead += (deadTarget - game.dead) * (1 - Math.exp(-3 * realDt));
  document.body.classList.toggle('dead', deadTarget === 1);

  // camera: gentle follow, breathing, impact shake
  game.shake *= Math.exp(-7 * realDt);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.3 : 1;
  const sx = (Math.random() - 0.5) * game.shake * reduce;
  const sy = (Math.random() - 0.5) * game.shake * reduce;
  const followX = fox.x * view.follow;
  camera.position.x += (view.base.x + followX + Math.sin(time * 0.27) * 0.06 - camera.position.x) * (1 - Math.exp(-2.5 * realDt));
  camera.position.y = view.base.y + Math.sin(time * 0.41) * 0.04 + sy;
  camera.position.z = view.base.z;
  tmpV.set(camera.position.x * 0.6, view.look.y, view.look.z);
  camera.lookAt(tmpV);
  camera.position.x += sx;
  camera.updateMatrixWorld();
  sky.mesh.position.copy(camera.position);
  shared.uSunView.value.copy(theme.sunDir).transformDirection(camera.matrixWorldInverse);

  // start hint (icons only) next to the fox
  if (game.state === 'ready') {
    tmpV.set(fox.x, 0.55, 0).project(camera);
    const px = (tmpV.x * 0.5 + 0.5) * innerWidth;
    const py = (-tmpV.y * 0.5 + 0.5) * innerHeight;
    const edge = tmpV.set(fox.x + 1.7, 0.55, 0).project(camera);
    const gap = Math.abs((edge.x * 0.5 + 0.5) * innerWidth - px);
    ui.placeHint(px, py, gap);
  }

  if (renderThis !== false) {
    if (post) {
      post.update(theme, game.dead, time);
      post.render(realDt);
    } else {
      renderer.render(scene, camera);
    }
  }
  if (!MANUAL) {
    adaptQuality(realDt);
    requestAnimationFrame(frame);
  }
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */
async function boot() {
  document.body.classList.add('loading');
  const foxPromise = fox.load('./models/Fox.glb', (e) => {
    if (e.total) { progress.fox = e.loaded / e.total; showProgress(); }
  });
  await buildWorld();
  setPost(tier.post);
  resize();
  refreshEnvironment();
  await foxPromise;
  progress.fox = 1; showProgress();
  // compile every shader up front so the first frames don't hitch
  try {
    if (renderer.compileAsync) await renderer.compileAsync(scene, camera);
  } catch (e) { /* fall back to lazy compilation */ }
  game.state = 'ready';
  ui.setReady(true);
  lastNow = performance.now();
  requestAnimationFrame(frame);
  setTimeout(() => ui.loaded(), 120);
  if (MANUAL || params.has('debug')) window.__game = {
    game, fox, rocks, theme, weather, view, renderer, camera, quality, tier, input,
    step(n = 1, noRender = false) {
      for (let i = 0; i < n; i++) frame(!noRender && i === n - 1);
    },
  };
}

boot().catch((err) => {
  console.error(err);
  // last resort: the original version always works
  setTimeout(() => location.replace('./original/'), 50);
});
