// The ground: one warped grid that is dense underfoot and runs out to a mountain horizon,
// shaded by a four-layer PBR splat material.
//
// GEOMETRY. The main app's ground is a 400ft plane at one vertex per 3.3ft, and the world
// simply ends at its edge (hidden by fog). Here the grid is WARPED: the middle 62% of its
// rows cover the walkable 420ft at ~1.8ft a cell, and the outer rows are stretched by a
// power curve out to FAR_TERRAIN_RADIUS, so the same mesh that carries footprints-scale
// relief also carries the ridgeline five thousand feet away. One mesh, one draw call, and
// no seam to hide between a "near" and a "far" terrain.
//
// MATERIAL. Four photographic PBR layers -- lawn, worn ground, path, rock -- blended per
// pixel by: a painted MASK the world layout draws into (paths, pond beds, infields), the
// SLOPE of the surface (steep ground is rock), and low-frequency noise (so a lawn is never
// one flat carpet). Each layer is sampled at TWO scales and cross-faded by distance, which
// is what kills the visible tiling that a single repeat shows from any height.

import { Mesh, VertexData, Texture, DynamicTexture, Color3, Vector3 } from '@babylonjs/core';
import { PBRCustomMaterial } from '@babylonjs/materials';
import { GROUND_SIZE, FAR_TERRAIN_RADIUS } from '../config.js';
import { heightAt, classicHeightAt } from './Height.js';

// Three zones per half-axis, in CELLS: a dense core over the classic layouts (where ponds
// are carved and paths are read at arm's length), a middle band over the rest of the
// walkable world, and a stretched outer band running to the mountains.
const CORE_CELLS = 225; const CORE_EXTENT = 225; // 1ft cells over everything walkable
const MID_CELLS = 70; const MID_EXTENT = 760; // ~7.6ft cells: scenery, never walked on
const FAR_CELLS = 80;
const HALF = CORE_CELLS + MID_CELLS + FAR_CELLS;
const SEGMENTS = HALF * 2;
export const MASK_SIZE = 2048;
const MASK_WORLD = GROUND_SIZE; // feet covered by the mask, centred on the origin

function warpCell(i) {
  const k = Math.abs(i - HALF);
  let v;
  if (k <= CORE_CELLS) v = (k / CORE_CELLS) * CORE_EXTENT;
  else if (k <= CORE_CELLS + MID_CELLS) v = CORE_EXTENT + ((k - CORE_CELLS) / MID_CELLS) * (MID_EXTENT - CORE_EXTENT);
  else {
    const t = (k - CORE_CELLS - MID_CELLS) / FAR_CELLS;
    // Starts at the middle band's own cell size (no sudden jump) and accelerates outward.
    v = MID_EXTENT + t * FAR_CELLS * 7.6 + Math.pow(t, 2.4) * (FAR_TERRAIN_RADIUS - MID_EXTENT);
  }
  return i < HALF ? -v : v;
}

const texCache = new Map();
function tex(scene, url, srgb) {
  const key = url;
  if (!texCache.has(key)) {
    const t = new Texture(url, scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
    t.wrapU = t.wrapV = Texture.WRAP_ADDRESSMODE;
    t.anisotropicFilteringLevel = 16;
    t.gammaSpace = srgb;
    texCache.set(key, t);
  }
  return texCache.get(key);
}

export class Terrain {
  constructor(scene) {
    this.scene = scene;
    this.theme = null;

    this.mesh = new Mesh('terrain', scene);
    this.mesh.isPickable = true;
    this.mesh.receiveShadows = true;
    this.mesh.alwaysSelectAsActiveMesh = true;

    const n = SEGMENTS + 1;
    this.positions = new Float32Array(n * n * 3);
    this.normals = new Float32Array(n * n * 3);
    const uvs = new Float32Array(n * n * 2);
    const indices = new Uint32Array(SEGMENTS * SEGMENTS * 6);
    let p = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = warpCell(i);
        const z = warpCell(j);
        this.positions[p * 3] = x;
        this.positions[p * 3 + 2] = z;
        uvs[p * 2] = x;
        uvs[p * 2 + 1] = z;
        p++;
      }
    }
    let q = 0;
    for (let j = 0; j < SEGMENTS; j++) {
      for (let i = 0; i < SEGMENTS; i++) {
        const a = j * n + i;
        const b = a + 1;
        const c = a + n;
        const d = c + 1;
        // Wound for a right-handed scene with +Y up.
        indices[q++] = a; indices[q++] = b; indices[q++] = c;
        indices[q++] = b; indices[q++] = d; indices[q++] = c;
      }
    }
    const vd = new VertexData();
    vd.positions = this.positions;
    vd.normals = this.normals;
    vd.uvs = uvs;
    vd.indices = indices;
    vd.applyToMesh(this.mesh, true);
    this.indices = indices;

    // The mask: R = path/bare surface, G = worn ground, B = "no grass here" (water, floors).
    this.maskCanvas = document.createElement('canvas');
    this.maskCanvas.width = this.maskCanvas.height = MASK_SIZE;
    this.maskCtx = this.maskCanvas.getContext('2d', { willReadFrequently: true });
    this.maskTexture = new DynamicTexture('terrainMask', this.maskCanvas, scene, true);
    this.maskTexture.wrapU = this.maskTexture.wrapV = Texture.CLAMP_ADDRESSMODE;
    this.maskData = null;
    this.clearMask();
  }

  // --- mask painting ---------------------------------------------------------------------
  // World feet -> mask pixels. +Z maps to +v so the shader's lookup is a plain scale+offset.
  toMask(x, z) {
    return [(x / MASK_WORLD + 0.5) * MASK_SIZE, (z / MASK_WORLD + 0.5) * MASK_SIZE];
  }

  clearMask() {
    this.maskCtx.globalCompositeOperation = 'source-over';
    this.maskCtx.fillStyle = '#000';
    this.maskCtx.fillRect(0, 0, MASK_SIZE, MASK_SIZE);
  }

  // channel: 'path' | 'worn' | 'bare'. Painted additively with a soft edge.
  paintCircle(channel, x, z, radius, strength = 1, soft = 0.35) {
    const [px, pz] = this.toMask(x, z);
    const r = (radius / MASK_WORLD) * MASK_SIZE;
    const ctx = this.maskCtx;
    const g = ctx.createRadialGradient(px, pz, r * (1 - soft), px, pz, r);
    const c = channel === 'path' ? [255, 0, 0] : channel === 'worn' ? [0, 255, 0] : [0, 0, 255];
    g.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${strength})`);
    g.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, pz, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // A soft-edged ribbon through a list of [x, z] points -- a path.
  paintPath(channel, points, width, strength = 1) {
    const ctx = this.maskCtx;
    const c = channel === 'path' ? '255,0,0' : channel === 'worn' ? '0,255,0' : '0,0,255';
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Three passes of decreasing width stand in for a blurred edge.
    for (const [scale, alpha] of [[1.35, 0.3], [1.1, 0.4], [0.82, 0.6]]) {
      ctx.strokeStyle = `rgba(${c},${alpha * strength})`;
      ctx.lineWidth = (width * scale / MASK_WORLD) * MASK_SIZE;
      ctx.beginPath();
      points.forEach(([x, z], i) => {
        const [px, pz] = this.toMask(x, z);
        if (i === 0) ctx.moveTo(px, pz); else ctx.lineTo(px, pz);
      });
      ctx.stroke();
    }
  }

  paintRect(channel, x, z, w, d, rotY = 0, strength = 1) {
    const ctx = this.maskCtx;
    const c = channel === 'path' ? '255,0,0' : channel === 'worn' ? '0,255,0' : '0,0,255';
    const [px, pz] = this.toMask(x, z);
    const s = MASK_SIZE / MASK_WORLD;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(px, pz);
    ctx.rotate(-rotY);
    ctx.fillStyle = `rgba(${c},${strength})`;
    ctx.shadowColor = `rgba(${c},${strength})`;
    ctx.shadowBlur = 5;
    ctx.fillRect((-w / 2) * s, (-d / 2) * s, w * s, d * s);
    ctx.restore();
  }

  // Fills one world-space triangle into a mask channel. This is how a mirrored prop keeps the
  // grass out from under itself: every low, upward-facing triangle it has -- a floor, a deck,
  // a slab, a path -- is stamped into the mask exactly where it lies.
  paintTriangle(channel, ax, az, bx, bz, cx, cz) {
    const ctx = this.maskCtx;
    const [x0, y0] = this.toMask(ax, az); const [x1, y1] = this.toMask(bx, bz); const [x2, y2] = this.toMask(cx, cz);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.closePath(); ctx.fill();
  }

  beginTriangles(channel) {
    const ctx = this.maskCtx;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = channel === 'path' ? 'rgb(255,0,0)' : channel === 'worn' ? 'rgb(0,255,0)' : 'rgb(0,0,255)';
    ctx.strokeStyle = ctx.fillStyle;
  }

  commitMask() {
    this.maskTexture.update(false);
    this.maskData = this.maskCtx.getImageData(0, 0, MASK_SIZE, MASK_SIZE).data;
  }

  // CPU-side read of the mask, for the grass scatter. Returns [path, worn, bare] in 0..1.
  maskAt(x, z) {
    if (!this.maskData) return [0, 0, 0];
    const [fx, fz] = this.toMask(x, z);
    const ix = Math.min(MASK_SIZE - 1, Math.max(0, fx | 0));
    const iz = Math.min(MASK_SIZE - 1, Math.max(0, fz | 0));
    const o = (iz * MASK_SIZE + ix) * 4;
    return [this.maskData[o] / 255, this.maskData[o + 1] / 255, this.maskData[o + 2] / 255];
  }

  heightAt(x, z) {
    return heightAt(this.theme, x, z);
  }

  rimHeightAt(x, z) {
    return classicHeightAt(this.theme, x, z);
  }

  // --- geometry --------------------------------------------------------------------------
  applyTheme(theme) {
    this.theme = theme;
    const pos = this.positions;
    const count = pos.length / 3;
    for (let i = 0; i < count; i++) pos[i * 3 + 1] = heightAt(theme, pos[i * 3], pos[i * 3 + 2]);
    VertexData.ComputeNormals(pos, this.indices, this.normals);
    // Whichever handedness convention ComputeNormals assumed, the ground faces UP.
    if (this.normals[1] < 0) for (let i = 0; i < this.normals.length; i++) this.normals[i] = -this.normals[i];
    this.mesh.updateVerticesData('position', pos);
    this.mesh.updateVerticesData('normal', this.normals);
    this.mesh.refreshBoundingInfo();
    this.buildMaterial(theme);
  }

  buildMaterial(theme) {
    this.mesh.material?.dispose(false, false);
    const scene = this.scene;
    const mat = new PBRCustomMaterial('terrainMat', scene);
    mat.metallic = 0;
    mat.roughness = 0.94;
    mat.albedoColor = Color3.White();
    mat.environmentIntensity = 0.75;
    // Grass and dust have essentially no mirror reflection; without this the whole lawn
    // picks up a grey sheen from the sky at grazing angles.
    mat.specularIntensity = 0.35;

    const layers = ['base', 'alt', 'path', 'rock'];
    layers.forEach((name, i) => {
      const layer = theme.ground[name];
      mat.AddUniform(`layerC${i}`, 'sampler2D', tex(scene, `textures/${layer.set}/color.jpg`, true));
      mat.AddUniform(`layerN${i}`, 'sampler2D', tex(scene, `textures/${layer.set}/normal.jpg`, false));
      mat.AddUniform(`layerTint${i}`, 'vec3', new Vector3(...layer.tint));
      mat.AddUniform(`layerScale${i}`, 'float', 1 / layer.scale);
      mat.AddUniform(`layerDesat${i}`, 'float', layer.desaturate ?? 0);
    });
    mat.AddUniform('maskSampler', 'sampler2D', this.maskTexture);
    mat.AddUniform('maskWorld', 'float', MASK_WORLD);
    const hillHex = theme.hills?.tint ?? 0x555555;
    mat.AddUniform('hillTint', 'vec3', (() => { const c = Color3.FromHexString('#' + hillHex.toString(16).padStart(6, '0')).toLinearSpace(); return new Vector3(c.r, c.g, c.b); })());
    mat.AddUniform('snowLine', 'float', theme.hills?.snow || 0);

    mat.Fragment_Definitions(`
      float gRough;
      float tHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float tNoise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(tHash(i), tHash(i + vec2(1.0, 0.0)), u.x), mix(tHash(i + vec2(0.0, 1.0)), tHash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      float tFbm(vec2 p) { float s = 0.0; float a = 0.5; for (int i = 0; i < 4; i++) { s += a * tNoise(p); p = mat2(0.8, -0.6, 0.6, 0.8) * p * 2.07; a *= 0.5; } return s; }
      // One layer, sampled at two scales and cross-faded by distance. Returns colour in rgb
      // and packs nothing else; normals come through a second call.
      vec3 layerColor(sampler2D s, vec2 p, float scale, float farMix, vec3 tint, float desat) {
        vec3 nearC = texture2D(s, p * scale).rgb;
        vec3 farC = texture2D(s, p * scale * 0.137 + 0.37).rgb;
        vec3 c = mix(nearC, farC, farMix);
        // Textures arrive sRGB-encoded through a plain sampler; decode before any maths.
        c = pow(c, vec3(2.2));
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(c, vec3(l), desat);
        return c * tint;
      }
      vec2 layerNormal(sampler2D s, vec2 p, float scale, float farMix) {
        vec2 a = texture2D(s, p * scale).xy * 2.0 - 1.0;
        vec2 b = texture2D(s, p * scale * 0.137 + 0.37).xy * 2.0 - 1.0;
        return mix(a, b * 0.6, farMix);
      }
    `);

    mat.Fragment_Before_Lights(`
      vec2 wp = vPositionW.xz;
      float camDist = length(vEyePosition.xyz - vPositionW);
      float farMix = smoothstep(45.0, 220.0, camDist);
      vec3 geoN = normalize(vNormalW);
      float slope = 1.0 - geoN.y;

      vec3 mask = vec3(0.0);
      vec2 muv = wp / maskWorld + 0.5;
      if (muv.x > 0.0 && muv.x < 1.0 && muv.y > 0.0 && muv.y < 1.0) mask = texture2D(maskSampler, muv).rgb;

      // Patchiness: a lawn is never one carpet. Broad noise pushes some of it toward the
      // worn layer, and a finer term frays the edge of every painted path.
      float broad = tFbm(wp * 0.021 + 3.1);
      float fine = tNoise(wp * 0.9);
      // mask.b (no-grass: pond beds, under buildings) goes to the worn layer as well, darkened
      // below into wet mud, so a carved basin is not lined with lawn.
      float wAlt = clamp(smoothstep(0.52, 0.78, broad) * 0.75 + mask.g + mask.b, 0.0, 1.0);
      float wPath = smoothstep(0.35, 0.65, mask.r + (fine - 0.5) * 0.35);
      float wRock = smoothstep(0.16, 0.42, slope + (broad - 0.5) * 0.12);

      vec3 c0 = layerColor(layerC0, wp, layerScale0, farMix, layerTint0, layerDesat0);
      vec3 c1 = layerColor(layerC1, wp, layerScale1, farMix, layerTint1, layerDesat1);
      vec3 c2 = layerColor(layerC2, wp, layerScale2, farMix, layerTint2, layerDesat2);
      vec3 c3 = layerColor(layerC3, wp, layerScale3, farMix, layerTint3, layerDesat3);
      vec2 n0 = layerNormal(layerN0, wp, layerScale0, farMix);
      vec2 n1 = layerNormal(layerN1, wp, layerScale1, farMix);
      vec2 n2 = layerNormal(layerN2, wp, layerScale2, farMix);
      vec2 n3 = layerNormal(layerN3, wp, layerScale3, farMix);

      vec3 col = mix(c0, c1, wAlt);
      vec2 nrm = mix(n0, n1, wAlt);
      float rough = mix(0.93, 0.97, wAlt);
      col *= mix(1.0, 0.5, mask.b);
      col = mix(col, c2, wPath); nrm = mix(nrm, n2, wPath); rough = mix(rough, 0.88, wPath);
      col = mix(col, c3, wRock); nrm = mix(nrm, n3 * 1.4, wRock); rough = mix(rough, 0.82, wRock);

      // Large-scale colour drift, so the far lawn is not the near lawn repeated.
      col *= 0.82 + 0.36 * tFbm(wp * 0.0065 + 17.0);

      // Far hills: haze the photographic layers toward the theme's hill tint with distance,
      // since at a mile out no texture survives and colour is all there is.
      float hillMix = smoothstep(700.0, 3600.0, length(wp));
      col = mix(col, hillTint * (0.55 + 0.75 * tFbm(wp * 0.0021)) * mix(1.0, 0.72, wRock), hillMix * 0.8);
      if (snowLine > 1.5) {
        float snow = smoothstep(snowLine, snowLine + 90.0, vPositionW.y + tFbm(wp * 0.004) * 120.0) * (1.0 - smoothstep(0.35, 0.7, slope));
        col = mix(col, vec3(0.9, 0.93, 0.97), snow); rough = mix(rough, 0.6, snow);
      }

      surfaceAlbedo = col;
      gRough = rough;
      float nStrength = mix(1.0, 0.45, farMix);
      normalW = normalize(geoN + vec3(nrm.x, 0.0, nrm.y) * nStrength);
    `);
    mat.Fragment_Custom_MetallicRoughness(`metallicRoughness.g = gRough;`);

    this.mesh.material = mat;
    this.material = mat;
  }
}
