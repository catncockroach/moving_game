import * as THREE from 'three';

/**
 * Colour / lighting presets. "day" (lush green) is the default.
 * Every value is blended smoothly when the theme changes.
 */
export const PALETTES = {
  day: {
    skyTop: '#3d8bd6', skyHorizon: '#cfe6e6', sunDisk: '#fff8e8', sunGlow: '#ffe2a6', sunDiskVis: 1,
    cloud: '#ffffff', cloudShade: '#b7c7d3', cloudCover: 0.46, stars: 0,
    sunColor: '#fff1dc', sunIntensity: 3.1, sunElev: 52, sunAzim: -150,
    hemiSky: '#cfe5ff', hemiGround: '#5f7f3c', hemiIntensity: 1.15, envIntensity: 0.55,
    fog: '#c9e2e1', fogDensity: 0.0105,
    ground1: '#3a6a22', ground2: '#5d8c2b', path: '#a98458',
    grassBase: '#1d5018', grassTip: '#87bb47', grassDry: '#c9c070',
    leaf0: '#3c8a2e', leaf1: '#5aa23b', leaf2: '#2c7032', leaf3: '#7cb240', bark: '#5e4633',
    hill: '#5d9853', mountain: '#7ea7a6', hillHaze: 0.32, mountainHaze: 0.6,
    motes: '#fff4d2', moteMode: 0, flowerGlow: 0,
    exposure: 1.0, bloom: 0.26, saturation: 1.1, contrast: 1.05, tint: '#fffdf6', wind: 1,
    dust: '#cdb48d',
  },
  sunset: {
    skyTop: '#4e6ea8', skyHorizon: '#f6c08e', sunDisk: '#fff0c8', sunGlow: '#ff9d4f', sunDiskVis: 1,
    cloud: '#ffd7b0', cloudShade: '#a07a8f', cloudCover: 0.42, stars: 0,
    sunColor: '#ffb36e', sunIntensity: 2.6, sunElev: 9, sunAzim: -158,
    hemiSky: '#f3c9b0', hemiGround: '#5a5236', hemiIntensity: 1.0, envIntensity: 0.6,
    fog: '#e7b996', fogDensity: 0.0115,
    ground1: '#3d5e21', ground2: '#6a7e2a', path: '#a77b55',
    grassBase: '#284d18', grassTip: '#b6b94e', grassDry: '#e0b25e',
    leaf0: '#4b7a2a', leaf1: '#6f8f33', leaf2: '#3a6a2c', leaf3: '#9a9a3c', bark: '#5a3e2f',
    hill: '#7c7a5c', mountain: '#b08e8c', hillHaze: 0.42, mountainHaze: 0.7,
    motes: '#ffd9a0', moteMode: 0, flowerGlow: 0,
    exposure: 1.02, bloom: 0.42, saturation: 1.08, contrast: 1.06, tint: '#fff2e2', wind: 0.8,
    dust: '#d6a77d',
  },
  autumn: {
    skyTop: '#5a95cf', skyHorizon: '#e6e1cf', sunDisk: '#fff6e0', sunGlow: '#ffd59a', sunDiskVis: 1,
    cloud: '#fffaf0', cloudShade: '#bfb8b0', cloudCover: 0.5, stars: 0,
    sunColor: '#ffe2bd', sunIntensity: 2.9, sunElev: 38, sunAzim: -150,
    hemiSky: '#e6e2d6', hemiGround: '#7a5a32', hemiIntensity: 1.1, envIntensity: 0.55,
    fog: '#e3dccb', fogDensity: 0.011,
    ground1: '#5e6a26', ground2: '#8a7a32', path: '#a17a52',
    grassBase: '#4a5a1c', grassTip: '#c9b25a', grassDry: '#d98f3e',
    leaf0: '#d9712b', leaf1: '#e8a93a', leaf2: '#b8452a', leaf3: '#8a9a36', bark: '#4f3a2c',
    hill: '#a07a45', mountain: '#a99e8f', hillHaze: 0.36, mountainHaze: 0.62,
    motes: '#ffe7c0', moteMode: 0, flowerGlow: 0,
    exposure: 1.0, bloom: 0.3, saturation: 1.1, contrast: 1.05, tint: '#fff6ea', wind: 1.25,
    dust: '#cfac80',
  },
  night: {
    skyTop: '#0b1530', skyHorizon: '#2d4670', sunDisk: '#f4f2ff', sunGlow: '#7088cc', sunDiskVis: 0.5,
    cloud: '#4a5a80', cloudShade: '#1c2640', cloudCover: 0.32, stars: 1,
    sunColor: '#a9bcff', sunIntensity: 1.9, sunElev: 13, sunAzim: -160,
    hemiSky: '#6a84c4', hemiGround: '#24362e', hemiIntensity: 1.05, envIntensity: 0.6,
    fog: '#22365a', fogDensity: 0.012,
    ground1: '#1f3d2a', ground2: '#2c5032', path: '#5d5866',
    grassBase: '#10301f', grassTip: '#4f8a5a', grassDry: '#6f8a72',
    leaf0: '#1f5a3e', leaf1: '#2f6e48', leaf2: '#18483a', leaf3: '#3e7a52', bark: '#3a3340',
    hill: '#203a42', mountain: '#2c4566', hillHaze: 0.4, mountainHaze: 0.62,
    motes: '#d6ff7a', moteMode: 1, flowerGlow: 0.6,
    exposure: 1.25, bloom: 0.7, saturation: 1.05, contrast: 1.04, tint: '#e8f0ff', wind: 0.6,
    dust: '#8c8aa0',
  },
};

export const THEME_NAMES = Object.keys(PALETTES);

const isColor = (v) => typeof v === 'string' && v[0] === '#';

function materialise(p) {
  const out = {};
  for (const [k, v] of Object.entries(p)) out[k] = isColor(v) ? new THREE.Color(v) : v;
  return out;
}

export class Theme {
  constructor(name = 'day') {
    this.name = PALETTES[name] ? name : 'day';
    this.cur = materialise(PALETTES[this.name]);
    this.from = null;
    this.to = null;
    this.t = 1;
    this.sunDir = new THREE.Vector3();
    this.computeSun();
  }

  set(name) {
    if (!PALETTES[name] || name === this.name) return;
    this.name = name;
    this.from = {};
    for (const [k, v] of Object.entries(this.cur)) this.from[k] = v && v.isColor ? v.clone() : v;
    this.to = materialise(PALETTES[name]);
    this.t = 0;
  }

  /** Returns true while a transition is in progress. */
  update(dt) {
    if (this.t >= 1) return false;
    this.t = Math.min(1, this.t + dt / 1.8);
    const k = this.t * this.t * (3 - 2 * this.t);
    for (const key of Object.keys(this.cur)) {
      const a = this.from[key], b = this.to[key];
      if (a && a.isColor) this.cur[key].copy(a).lerp(b, k);
      else if (typeof a === 'number') this.cur[key] = a + (b - a) * k;
    }
    this.computeSun();
    return true;
  }

  computeSun() {
    const el = THREE.MathUtils.degToRad(this.cur.sunElev);
    const az = THREE.MathUtils.degToRad(this.cur.sunAzim);
    this.sunDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize();
  }
}
