import * as THREE from 'three';

/** Small procedural textures painted on canvases (no external image files needed). */

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function finish(c, { srgb = true, mips = true } = {}) {
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = mips;
  tex.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  tex.anisotropy = 4;
  return tex;
}

function leafPath(ctx, len, wid) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(wid, -len * 0.25, wid * 0.8, -len * 0.75, 0, -len);
  ctx.bezierCurveTo(-wid * 0.8, -len * 0.75, -wid, -len * 0.25, 0, 0);
  ctx.closePath();
}

/** A cluster of leaves in grey-scale; the shader tints it per theme. */
export function leafClusterTexture() {
  const S = 256;
  const [c, ctx] = canvas(S);
  const rnd = seeded(7);
  ctx.translate(S / 2, S / 2);
  const leaves = 30;
  for (let i = 0; i < leaves; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 18 + rnd() * 62;
    const len = 46 + rnd() * 34;
    const wid = 15 + rnd() * 9;
    ctx.save();
    ctx.translate(Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6);
    ctx.rotate(a + Math.PI / 2 + (rnd() - 0.5) * 0.9);
    const g = 150 + Math.floor(rnd() * 105);
    const grad = ctx.createLinearGradient(-wid, 0, wid, 0);
    grad.addColorStop(0, `rgb(${g * 0.78 | 0},${g * 0.78 | 0},${g * 0.78 | 0})`);
    grad.addColorStop(0.5, `rgb(${g},${g},${g})`);
    grad.addColorStop(1, `rgb(${g * 0.86 | 0},${g * 0.86 | 0},${g * 0.86 | 0})`);
    ctx.fillStyle = grad;
    leafPath(ctx, len, wid);
    ctx.fill();
    ctx.strokeStyle = `rgba(0,0,0,0.18)`;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, -2); ctx.lineTo(0, -len * 0.9);
    ctx.stroke();
    ctx.restore();
  }
  return finish(c);
}

/** 2x2 atlas: daisy, buttercup, pink cosmos, blue forget-me-not. */
export function flowerAtlasTexture() {
  const S = 256, H = S / 2;
  const [c, ctx] = canvas(S);
  const defs = [
    { petals: 12, len: 50, wid: 11, color: '#fbfbf4', center: '#f4c430', cr: 15 },
    { petals: 5, len: 44, wid: 22, color: '#ffd93b', center: '#e5a50a', cr: 11 },
    { petals: 8, len: 48, wid: 17, color: '#f39ac4', center: '#f7d154', cr: 12 },
    { petals: 5, len: 38, wid: 20, color: '#8fb8ff', center: '#fff2a8', cr: 10 },
  ];
  defs.forEach((d, i) => {
    const cx = (i % 2) * H + H / 2, cy = Math.floor(i / 2) * H + H / 2;
    ctx.save();
    ctx.translate(cx, cy);
    for (let p = 0; p < d.petals; p++) {
      ctx.save();
      ctx.rotate((p / d.petals) * Math.PI * 2);
      const grad = ctx.createLinearGradient(0, 0, 0, -d.len);
      grad.addColorStop(0, d.color);
      grad.addColorStop(1, d.color);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(0, -d.len * 0.52, d.wid * 0.5, d.len * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.08)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
    const cg = ctx.createRadialGradient(-3, -3, 1, 0, 0, d.cr);
    cg.addColorStop(0, '#fff6c0');
    cg.addColorStop(1, d.center);
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(0, 0, d.cr, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
  return finish(c);
}

/** Soft radial blob (white with alpha falloff). */
export function softDiscTexture(size = 128, inner = 0.0) {
  const [c, ctx] = canvas(size);
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.5 * inner, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return finish(c, { srgb: false });
}

/** Butterfly wing (right wing; mirrored by geometry). */
export function butterflyTexture(main, edge) {
  const S = 128;
  const [c, ctx] = canvas(S);
  ctx.translate(4, S / 2);
  const draw = (fill) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(0, -4);
    ctx.bezierCurveTo(30, -70, 120, -62, 112, -18);
    ctx.bezierCurveTo(108, -4, 70, -2, 40, 0);
    ctx.bezierCurveTo(80, 6, 96, 30, 78, 50);
    ctx.bezierCurveTo(60, 66, 20, 40, 0, 6);
    ctx.closePath();
    ctx.fill();
  };
  draw(edge);
  ctx.save();
  ctx.scale(0.86, 0.82);
  ctx.translate(4, 0);
  draw(main);
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (const [x, y, r] of [[86, -34, 6], [70, -44, 4], [60, 30, 5]]) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  return finish(c);
}

/** Single leaf for falling leaves (grey-scale, tinted in material). */
export function singleLeafTexture() {
  const S = 64;
  const [c, ctx] = canvas(S);
  ctx.translate(S / 2, S - 4);
  ctx.fillStyle = '#e8e8e8';
  leafPath(ctx, S - 8, 20);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -(S - 14)); ctx.stroke();
  return finish(c);
}

/** Five pointed star used for the "dizzy" effect. */
export function starShape(outer = 1, inner = 0.45) {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? inner : outer;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}

export { seeded };
