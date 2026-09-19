// Water surfaces: ponds, fountain basins.
//
// One shared material. The surface normal is built per pixel from a procedural ripple map
// sampled twice in WORLD space at different scales and drift velocities, so two ponds never
// show the same pattern and no pond shows a seam. Reflection comes from the sky probe (so
// the water is the colour of the sky at that hour, which is what water is), the sun's
// specular off those rippled normals is what glitters through the bloom pass, and opacity
// follows a Fresnel term: look straight down and you see the bed, look across and you see sky.

import { DynamicTexture, Texture, Vector3, PBRMaterial } from '@babylonjs/core';
import { PBRCustomMaterial } from '@babylonjs/materials';
import { linear } from '../props/Kit.js';

function rippleCanvas(size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  // Every frequency is a whole number of cycles across the tile, so it wraps cleanly.
  const waves = [];
  let s = 7;
  const rand = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 22; i++) {
    const f = 2 + Math.floor(rand() * 14);
    const a = rand() * Math.PI * 2;
    waves.push({ kx: Math.round(Math.cos(a) * f), ky: Math.round(Math.sin(a) * f), ph: rand() * 6.28, amp: 1 / (f * 0.6) });
  }
  const H = (x, y) => {
    let h = 0;
    for (const w of waves) h += Math.sin((x * w.kx + y * w.ky) * Math.PI * 2 + w.ph) * w.amp;
    return h;
  };
  const e = 1 / size;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = i / size; const y = j / size;
      const dx = (H(x + e, y) - H(x - e, y)) * 0.055 * size * 0.02;
      const dy = (H(x, y + e) - H(x, y - e)) * 0.055 * size * 0.02;
      const o = (j * size + i) * 4;
      img.data[o] = Math.max(0, Math.min(255, 128 + dx * 127));
      img.data[o + 1] = Math.max(0, Math.min(255, 128 + dy * 127));
      img.data[o + 2] = 255; img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export class Water {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;
    this.meshes = [];
    const ripple = new DynamicTexture('ripples', rippleCanvas(), scene, true);
    ripple.wrapU = ripple.wrapV = Texture.WRAP_ADDRESSMODE;
    ripple.gammaSpace = false;
    ripple.anisotropicFilteringLevel = 8;
    ripple.update(false);

    const mat = new PBRCustomMaterial('water', scene);
    mat.metallic = 0;
    mat.roughness = 0.035;
    mat.albedoColor = linear(0x1f4f52);
    mat.alpha = 0.9;
    mat.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
    mat.backFaceCulling = false;
    mat.indexOfRefraction = 1.33;
    mat.environmentIntensity = 1.35;
    mat.AddUniform('wTime', 'float', 0);
    mat.AddUniform('wRipple', 'sampler2D', ripple);
    mat.Fragment_Before_Lights(`
      vec2 wp = vPositionW.xz;
      vec2 r1 = texture2D(wRipple, wp * 0.11 + vec2(wTime * 0.013, wTime * 0.009)).xy * 2.0 - 1.0;
      vec2 r2 = texture2D(wRipple, wp * 0.31 - vec2(wTime * 0.021, -wTime * 0.017)).xy * 2.0 - 1.0;
      vec2 rr = r1 * 0.6 + r2 * 0.4;
      normalW = normalize(vec3(rr.x * 0.55, 1.0, rr.y * 0.55));
      vec3 wView = normalize(vEyePosition.xyz - vPositionW);
      float wFres = pow(1.0 - clamp(dot(wView, normalW), 0.0, 1.0), 3.0);
      alpha = mix(0.62, 0.985, wFres);
    `);
    mat.onBindObservable.add(() => mat.getEffect()?.setFloat('wTime', this.time));
    mat.metadata = { flat: true };
    this.material = mat;
  }

  applyTheme(theme) { this.material.albedoColor = linear(theme.water ?? 0x1f4f52); }
  clear() { this.meshes = []; }
  add() { /* water meshes are owned by their prop; nothing to track yet */ }
  update(dt) { this.time += dt; }
}
