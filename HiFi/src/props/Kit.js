// The modelling kit every HiFi prop is built from.
//
// House rules, carried over from the main app's PropKit and still right:
//   * authored in FEET at scale 1, origin at the BASE CENTRE, facing +Z;
//   * randomness only through seededRandom(), so a world rebuilt from its layout is the
//     world the student first saw;
//   * a prop MERGES to one mesh per material. Draw calls are still CPU cost on a fast GPU.
//
// What is different here is the material model. The main app paints vertex colours and
// fakes relief with a generated bump tile; HiFi surfaces are photographic PBR sets (albedo,
// normal, roughness, AO) lit by the sky probe, and texel density is kept CONSTANT: the
// Builder re-projects every solid's UVs in feet after its transform is baked, so a plank is
// the same plank on a 2ft bench slat and a 30ft wall, and nothing is ever stretched.

import {
  Mesh, MeshBuilder, VertexData, VertexBuffer, PBRMaterial, Texture, DynamicTexture, Color3, Vector3, TransformNode,
  Matrix, Quaternion,
} from '@babylonjs/core';

export function seededRandom(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export const hex = (h) => Color3.FromHexString('#' + h.toString(16).padStart(6, '0'));
export const linear = (h) => hex(h).toLinearSpace();

// Tile size in feet for each photographic set: how much real surface one repeat covers.
const SET_TILE = {
  Bark012: 3, Concrete034: 8, Grass004: 8, Gravel022: 5, Ground037: 8, Ground054: 8, Ground068: 8,
  Metal032: 4, PavingStones070: 5, Planks012: 5, Rock030: 9, Rock035: 9, RoofingTiles013A: 5, Wood049: 4,
};
const SETS_WITHOUT_AO = new Set(['Concrete034', 'Metal032', 'Wood049', 'RoofingTiles013A']);

// MEAN LINEAR COLOUR of each set's albedo map, measured off the shipped JPEGs rather than
// guessed. It is what `neutral` divides by, and the numbers are the reason it had to exist:
// `Planks012` averages 0.068 linear luminance and `RoofingTiles013A` averages 0.031, so a
// material tinted to a pale khaki and left at gain 1 renders at SEVEN PER CENT of the colour
// it was asked for. A whole street of tan houses came out near-black that way, and it read as
// a lighting bug rather than as an albedo one -- the inverse of the trap Ellis Island's black
// steamship hull records, and much harder to see, because "too dark" looks like shadow.
//
// The cast matters as well as the level: Planks012 is 0.097/0.063/0.038 in RGB, a strong
// red-brown, so a scalar gain leaves every colour on top of it skewed warm. Dividing per
// CHANNEL is the main app's `neutralized()` trick arriving here -- the photo then contributes
// grain, grime and relief, and the tint owns the hue.
const SET_MEAN = {
  Bark012: [0.265, 0.203, 0.091],
  Concrete034: [0.484, 0.481, 0.481],
  Grass004: [0.128, 0.162, 0.035],
  Gravel022: [0.227, 0.213, 0.174],
  Ground037: [0.332, 0.307, 0.112],
  Ground054: [0.333, 0.258, 0.156],
  Ground068: [0.168, 0.110, 0.027],
  Metal032: [0.206, 0.248, 0.295],
  PavingStones070: [0.277, 0.268, 0.244],
  Planks012: [0.097, 0.063, 0.038],
  Rock030: [0.085, 0.079, 0.066],
  Rock035: [0.007, 0.013, 0.015],
  RoofingTiles013A: [0.032, 0.030, 0.036],
  Wood049: [0.203, 0.127, 0.078],
};

function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export class Kit {
  constructor(scene, quality = { detail: 1, lodDistance: 300 }) {
    this.scene = scene;
    this.quality = quality;
    // Tessellation multiplier. Every round thing in the kit is authored against the 'high'
    // tier's counts and scaled from there, so 'ultra' genuinely buys rounder columns.
    this.detail = quality.detail ?? 1;
    this.materials = new Map();
    this.textures = new Map();
    this.pending = [];
  }

  texture(url, srgb) {
    if (!this.textures.has(url)) {
      const t = new Texture(url, this.scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
      t.anisotropicFilteringLevel = 16;
      t.gammaSpace = srgb;
      this.textures.set(url, t);
    }
    return this.textures.get(url);
  }

  // A set's colour map with its HUE removed. Lunar regolith and lunar rock are grey, and a tint
  // cannot make them so: a tint multiplies, and a tan sand photo times any grey is still tan.
  // Returned at once (mid grey) and filled in when the image arrives.
  greyTexture(set) {
    const key = `grey:${set}`;
    if (this.textures.has(key)) return this.textures.get(key);
    const size = 2048;
    const dt = new DynamicTexture(key, { width: size, height: size }, this.scene, true);
    dt.anisotropicFilteringLevel = 16;
    const ctx = dt.getContext();
    ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, size, size); dt.update();
    this.pending.push(loadImage(`textures/${set}/color.jpg`).then((img) => {
      if (!img) return;
      ctx.drawImage(img, 0, 0, size, size);
      const d = ctx.getImageData(0, 0, size, size); const a = d.data;
      for (let i = 0; i < a.length; i += 4) { const l = 0.2126 * a[i] + 0.7152 * a[i + 1] + 0.0722 * a[i + 2]; a[i] = a[i + 1] = a[i + 2] = l; }
      ctx.putImageData(d, 0, 0); dt.update();
    }));
    this.textures.set(key, dt);
    return dt;
  }

  // Occlusion / Roughness / Metalness packed into one texture, composed here from the
  // set's separate greyscale maps. Returned immediately (neutral grey) and filled in when
  // the images arrive, so building a world never waits on the network.
  ormTexture(set, metal) {
    const key = `orm:${set}:${metal}`;
    if (this.textures.has(key)) return this.textures.get(key);
    const size = 2048;
    const dt = new DynamicTexture(key, { width: size, height: size }, this.scene, true);
    dt.gammaSpace = false;
    dt.anisotropicFilteringLevel = 8;
    const ctx = dt.getContext();
    ctx.fillStyle = `rgb(255,200,${metal ? 255 : 0})`;
    ctx.fillRect(0, 0, size, size);
    dt.update();
    const job = Promise.all([
      loadImage(`textures/${set}/rough.jpg`),
      SETS_WITHOUT_AO.has(set) ? null : loadImage(`textures/${set}/ao.jpg`),
    ]).then(([rough, ao]) => {
      if (!rough) return;
      const scratch = document.createElement('canvas');
      scratch.width = scratch.height = size;
      const sctx = scratch.getContext('2d', { willReadFrequently: true });
      sctx.drawImage(rough, 0, 0, size, size);
      const r = sctx.getImageData(0, 0, size, size);
      let a = null;
      if (ao) { sctx.drawImage(ao, 0, 0, size, size); a = sctx.getImageData(0, 0, size, size); }
      const out = r.data;
      for (let i = 0; i < out.length; i += 4) {
        const rv = out[i];
        out[i] = a ? a.data[i] : 255;
        out[i + 1] = rv;
        out[i + 2] = metal ? 255 : 0;
        out[i + 3] = 255;
      }
      ctx.putImageData(r, 0, 0);
      dt.update();
    });
    this.pending.push(job);
    this.textures.set(key, dt);
    return dt;
  }

  // A photographic PBR material. `tint` multiplies the albedo (sRGB hex), `tile` overrides
  // the set's default feet-per-repeat, `rough` scales the roughness map.
  // `neutral` (0..1) divides the albedo by the set's own measured mean, per channel, so the
  // material renders as `tint` rather than as `tint` seen through the photograph. 1 is fully
  // neutral -- the photo contributes only its light and shade -- and something like 0.8 keeps
  // a little of the material's own character, which is usually what wood and brick want.
  mat(set, { tint = 0xffffff, gain = 1, tile, rough = 1, metal = false, bump = 1, emissive, grey = false, vertexColors = false, neutral = 0 } = {}) {
    const key = `${set}|${tint}|${gain}|${tile}|${rough}|${metal}|${bump}|${emissive}|${grey}|${vertexColors}|${neutral}`;
    if (this.materials.has(key)) return this.materials.get(key);
    const m = new PBRMaterial(key, this.scene);
    m.albedoTexture = grey ? this.greyTexture(set) : this.texture(`textures/${set}/color.jpg`, true);
    m.bumpTexture = this.texture(`textures/${set}/normal.jpg`, false);
    m.bumpTexture.level = bump;
    m.invertNormalMapX = false;
    m.invertNormalMapY = false;
    m.metallicTexture = this.ormTexture(set, metal);
    m.useAmbientOcclusionFromMetallicTextureRed = true;
    m.useRoughnessFromMetallicTextureGreen = true;
    m.useRoughnessFromMetallicTextureAlpha = false;
    m.useMetallnessFromMetallicTextureBlue = true;
    m.metallic = 1;
    m.roughness = rough;
    // `gain` lifts a set that photographs dark (roof tiles, bark) without changing its hue;
    // an albedo multiplier above 1 is fine, the texture under it is well below 1.
    m.albedoColor = linear(tint).scale(gain);
    if (neutral > 0 && SET_MEAN[set] && !grey) {
      const mean = SET_MEAN[set];
      const k = (i) => 1 / (1 * (1 - neutral) + mean[i] * neutral);
      m.albedoColor = new Color3(m.albedoColor.r * k(0), m.albedoColor.g * k(1), m.albedoColor.b * k(2));
    }
    if (emissive) m.emissiveColor = linear(emissive);
    m.metadata = { tile: tile ?? SET_TILE[set] ?? 5, vertexColors };
    this.materials.set(key, m);
    return m;
  }

  // A flat-colour PBR material, for paint, glass, enamel and anything a photo would not help.
  flat(color, { rough = 0.6, metal = 0, emissive, emissiveIntensity = 1, alpha = 1, doubleSided = false, clearcoat = 0 } = {}) {
    const key = `flat|${color}|${rough}|${metal}|${emissive}|${emissiveIntensity}|${alpha}|${doubleSided}|${clearcoat}`;
    if (this.materials.has(key)) return this.materials.get(key);
    const m = new PBRMaterial(key, this.scene);
    m.albedoColor = linear(color);
    m.metallic = metal;
    m.roughness = rough;
    if (emissive !== undefined) { m.emissiveColor = linear(emissive).scale(emissiveIntensity); }
    if (alpha < 1) { m.alpha = alpha; m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND; }
    if (doubleSided) { m.backFaceCulling = false; m.twoSidedLighting = true; }
    if (clearcoat) { m.clearCoat.isEnabled = true; m.clearCoat.intensity = clearcoat; m.clearCoat.roughness = 0.08; }
    m.metadata = { tile: 1, flat: true };
    this.materials.set(key, m);
    return m;
  }

  // A material showing a canvas (a sign face). Lit, slightly emissive so type stays legible
  // in shade and at dusk.
  canvasMat(name, canvas, { emissive = 0.1, rough = 0.55, alpha = false } = {}) {
    const dt = new DynamicTexture(name, canvas, this.scene, true);
    dt.anisotropicFilteringLevel = 16;
    dt.update(true);
    dt.hasAlpha = alpha;
    const m = new PBRMaterial(name, this.scene);
    m.albedoTexture = dt;
    m.metallic = 0;
    m.roughness = rough;
    if (emissive > 0) { m.emissiveTexture = dt; m.emissiveColor = new Color3(emissive, emissive, emissive); }
    if (alpha) { m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST; m.alphaCutOff = 0.5; m.useAlphaFromAlbedoTexture = true; }
    m.metadata = { tile: 1, keepUV: true };
    return m;
  }

  // ---- solids -----------------------------------------------------------------------------
  // All return an unparented Mesh centred on its own origin; the Builder places them.

  // A box with CHAMFERED edges. A dead-sharp edge never catches a highlight, which is most
  // of why a scene built from raw boxes reads as CG; an eighth of an inch of chamfer does.
  box(w, h, d, { bevel } = {}) {
    const b = Math.min(bevel ?? Math.min(w, h, d) * 0.06, 0.12, Math.min(w, h, d) * 0.45);
    const hw = w / 2; const hh = h / 2; const hd = d / 2;
    const polys = [];
    const v = (sx, sy, sz, axis) => new Vector3(
      sx * (axis === 0 ? hw : hw - b), sy * (axis === 1 ? hh : hh - b), sz * (axis === 2 ? hd : hd - b),
    );
    const S = [-1, 1];
    // faces
    for (const s of S) {
      polys.push([v(s, -1, -1, 0), v(s, 1, -1, 0), v(s, 1, 1, 0), v(s, -1, 1, 0)]);
      polys.push([v(-1, s, -1, 1), v(1, s, -1, 1), v(1, s, 1, 1), v(-1, s, 1, 1)]);
      polys.push([v(-1, -1, s, 2), v(1, -1, s, 2), v(1, 1, s, 2), v(-1, 1, s, 2)]);
    }
    if (b > 1e-4) {
      // edges: along X (faces Y & Z), along Y (X & Z), along Z (X & Y)
      for (const s1 of S) for (const s2 of S) {
        polys.push([v(-1, s1, s2, 1), v(1, s1, s2, 1), v(1, s1, s2, 2), v(-1, s1, s2, 2)]);
        polys.push([v(s1, -1, s2, 0), v(s1, 1, s2, 0), v(s1, 1, s2, 2), v(s1, -1, s2, 2)]);
        polys.push([v(s1, s2, -1, 0), v(s1, s2, 1, 0), v(s1, s2, 1, 1), v(s1, s2, -1, 1)]);
      }
      for (const sx of S) for (const sy of S) for (const sz of S) polys.push([v(sx, sy, sz, 0), v(sx, sy, sz, 1), v(sx, sy, sz, 2)]);
    }
    return this.poly(polys);
  }

  // A flat-shaded solid from a list of convex polygons (arrays of Vector3). Each polygon is
  // oriented OUTWARD from `centre` automatically, so callers never think about winding.
  poly(polys, centre = Vector3.Zero()) {
    const positions = []; const normals = []; const indices = []; const uvs = [];
    for (const pts of polys) {
      const n = Vector3.Cross(pts[1].subtract(pts[0]), pts[2].subtract(pts[0])).normalize();
      const mid = pts.reduce((a, p) => a.add(p), Vector3.Zero()).scale(1 / pts.length);
      let list = pts;
      if (Vector3.Dot(n, mid.subtract(centre)) < 0) { n.scaleInPlace(-1); list = [...pts].reverse(); }
      const base = positions.length / 3;
      for (const p of list) { positions.push(p.x, p.y, p.z); normals.push(n.x, n.y, n.z); uvs.push(0, 0); }
      // Babylon culls as left-handed even in a right-handed scene, so emit the fan reversed.
      for (let i = 1; i < list.length - 1; i++) indices.push(base, base + i + 1, base + i);
    }
    const mesh = new Mesh('poly', this.scene);
    const vd = new VertexData();
    vd.positions = positions; vd.normals = normals; vd.indices = indices; vd.uvs = uvs;
    vd.applyToMesh(mesh);
    return mesh;
  }

  // An extruded prism: a 2D outline [[x, y], ...] in the XY plane, `depth` along Z, centred.
  prism(outline, depth) {
    const hz = depth / 2;
    const front = outline.map(([x, y]) => new Vector3(x, y, hz));
    const back = outline.map(([x, y]) => new Vector3(x, y, -hz));
    const cx = outline.reduce((a, p) => a + p[0], 0) / outline.length;
    const cy = outline.reduce((a, p) => a + p[1], 0) / outline.length;
    const polys = [front, back];
    for (let i = 0; i < outline.length; i++) {
      const j = (i + 1) % outline.length;
      polys.push([front[i], front[j], back[j], back[i]]);
    }
    return this.poly(polys, new Vector3(cx, cy, 0));
  }

  cyl(radiusTop, radiusBottom, height, { sides = 40, tile = 4, cap = true } = {}) {
    sides = Math.max(6, Math.round(sides * this.detail));
    const m = MeshBuilder.CreateCylinder('cyl', {
      diameterTop: radiusTop * 2, diameterBottom: radiusBottom * 2, height, tessellation: sides,
      cap: cap ? Mesh.CAP_ALL : Mesh.NO_CAP,
    }, this.scene);
    const r = Math.max(radiusTop, radiusBottom);
    scaleUV(m, Math.max(1, Math.round((Math.PI * 2 * r) / tile)), height / tile);
    m.metadata = { uvDone: true };
    return m;
  }

  sphere(radius, { segments = 32, sx = 1, sy = 1, sz = 1 } = {}) {
    segments = Math.max(6, Math.round(segments * this.detail));
    const m = MeshBuilder.CreateSphere('sph', { diameterX: radius * 2 * sx, diameterY: radius * 2 * sy, diameterZ: radius * 2 * sz, segments }, this.scene);
    return m;
  }

  // Surface of revolution from a profile [[radius, y], ...] written bottom-up.
  lathe(profile, { sides = 64, tile = 4 } = {}) {
    sides = Math.max(8, Math.round(sides * this.detail));
    const shape = profile.map(([r, y]) => new Vector3(r, y, 0));
    const m = MeshBuilder.CreateLathe('lathe', { shape, tessellation: sides, sideOrientation: Mesh.DOUBLESIDE, closed: true }, this.scene);
    const maxR = Math.max(...profile.map((p) => p[0]));
    let len = 0;
    for (let i = 1; i < profile.length; i++) len += Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]);
    scaleUV(m, len / tile, Math.max(1, Math.round((Math.PI * 2 * maxR) / tile)));
    m.metadata = { uvDone: true };
    return m;
  }

  // A swept tube with a per-point radius: limbs, rails, pipes, roots.
  tube(points, radii, { sides = 18, tile = 3, cap = true } = {}) {
    sides = Math.max(4, Math.round(sides * (sides <= 8 ? 1 : this.detail)));
    const path = points.map((p) => (p instanceof Vector3 ? p : new Vector3(p[0], p[1], p[2])));
    const rAt = Array.isArray(radii) ? (i) => radii[Math.min(i, radii.length - 1)] : () => radii;
    const m = MeshBuilder.CreateTube('tube', {
      path, radiusFunction: (i) => Math.max(0.001, rAt(i)), tessellation: sides, cap: cap ? Mesh.CAP_ALL : Mesh.NO_CAP,
    }, this.scene);
    let len = 0;
    for (let i = 1; i < path.length; i++) len += Vector3.Distance(path[i], path[i - 1]);
    const r = Array.isArray(radii) ? Math.max(...radii) : radii;
    scaleUV(m, len / tile, Math.max(1, Math.round((Math.PI * 2 * r) / tile)));
    m.metadata = { uvDone: true };
    return m;
  }

  // A smooth curve through control points, resampled: tube() wants plenty of samples.
  curve(points, samples = 16) {
    const pts = points.map((p) => (p instanceof Vector3 ? p : new Vector3(p[0], p[1], p[2])));
    if (pts.length < 3) return pts;
    const out = [];
    for (let i = 0; i <= samples; i++) {
      const t = (i / samples) * (pts.length - 1);
      const k = Math.min(pts.length - 2, Math.floor(t));
      const p0 = pts[Math.max(0, k - 1)]; const p1 = pts[k]; const p2 = pts[k + 1]; const p3 = pts[Math.min(pts.length - 1, k + 2)];
      out.push(Vector3.CatmullRom(p0, p1, p2, p3, t - k));
    }
    return out;
  }

  // A ROCK IS NOT A LUMPY SPHERE -- the main app's own lesson. A noise-displaced ball is a potato:
  // convex everywhere, no flat face, no sharp edge. What makes stone read as stone is that it
  // BROKE, so `facets` cuts real fracture planes into it using the SUPPORT FUNCTION of a convex
  // polyhedron: along direction d the surface is min(h_i / (d . n_i)) over the planes facing that
  // way. That is a pure function of DIRECTION, so shared corners move identically and nothing
  // tears. Each vertex then takes the normal of whichever surface won -- the plane's own normal
  // on a fracture face, the smooth one on the weathered curve between -- which is what keeps the
  // flats flat and the arrises sharp without flat-shading the whole rock.
  rock(radius, seed, { segments = 32, squash = 0.7, rough = 0.3, facets = 0 } = {}) {
    segments = Math.max(8, Math.round(segments * this.detail));
    const m = MeshBuilder.CreateSphere('rock', { diameter: 2, segments }, this.scene);
    const pos = m.getVerticesData(VertexBuffer.PositionKind);
    const rand = seededRandom(seed);
    const o = [rand() * 10, rand() * 10, rand() * 10];
    const stretch = [0.8 + rand() * 0.5, 1, 0.8 + rand() * 0.5];
    const planes = [];
    for (let i = 0; i < facets; i++) {
      // golden-angle spiral WITH jitter: free directions reliably leave one flank uncut
      const y = 1 - (2 * (i + 0.5)) / facets; const r = Math.sqrt(1 - y * y); const a = i * 2.39996 + rand() * 0.9;
      const n = new Vector3(Math.cos(a) * r + (rand() - 0.5) * 0.5, y + (rand() - 0.5) * 0.5, Math.sin(a) * r + (rand() - 0.5) * 0.5).normalize();
      planes.push({ n, h: 0.62 + rand() * 0.36 });
    }
    const winner = new Int16Array(pos.length / 3).fill(-1);
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i]; const y = pos[i + 1]; const z = pos[i + 2];
      const n = Math.sin(x * 2.1 + o[0]) * Math.cos(y * 2.4 + o[1]) * 0.5 + Math.sin(z * 2.9 + o[2] + x * 1.3) * 0.32
        + Math.sin(x * 5.3 + z * 4.7 + o[1]) * 0.12 + Math.cos(y * 6.1 + x * 3.9 + o[2]) * 0.1
        + Math.sin(x * 11.0 + y * 9.0 + o[0]) * Math.cos(z * 10.0 + o[1]) * 0.05 + Math.sin(z * 17.0 + x * 15.0 + o[2]) * 0.025;
      let k = 1 + n * rough;
      for (let p = 0; p < planes.length; p++) {
        const d = x * planes[p].n.x + y * planes[p].n.y + z * planes[p].n.z;
        if (d > 0.05) { const cut = planes[p].h / d; if (cut < k) { k = cut; winner[i / 3] = p; } }
      }
      k *= radius;
      pos[i] = x * k * stretch[0]; pos[i + 1] = y * k * squash; pos[i + 2] = z * k * stretch[2];
    }
    m.setVerticesData(VertexBuffer.PositionKind, pos);
    const nrm = [];
    VertexData.ComputeNormals(pos, m.getIndices(), nrm);
    for (let v = 0; v < winner.length; v++) {
      const p = winner[v]; if (p < 0) continue;
      // a plane normal, carried through the same non-uniform scale as the positions
      const pn = planes[p].n; const nx = pn.x / stretch[0]; const ny = pn.y / squash; const nz = pn.z / stretch[2];
      const l = Math.hypot(nx, ny, nz) || 1;
      nrm[v * 3] = nx / l; nrm[v * 3 + 1] = ny / l; nrm[v * 3 + 2] = nz / l;
    }
    m.setVerticesData(VertexBuffer.NormalKind, nrm);
    // Keep the sphere's own UVs, scaled to feet. Box projection puts a visible zig-zag seam
    // round a boulder wherever the dominant axis changes; a pinch at the two poles, one of
    // which is underground, is much the smaller evil.
    scaleUV(m, Math.max(1, Math.round((Math.PI * 2 * radius) / 5)), Math.max(1, Math.round((Math.PI * radius * squash) / 5)));
    m.metadata = { uvDone: true };
    return m;
  }

  // A quad in the XY plane FACING +Z, with u running left-to-right as seen from +Z. Built by
  // hand: Babylon's own plane faces -Z and its text reads mirrored in a right-handed scene.
  plane(w, h) {
    const mesh = new Mesh('plane', this.scene);
    const vd = new VertexData();
    vd.positions = [-w / 2, -h / 2, 0, w / 2, -h / 2, 0, w / 2, h / 2, 0, -w / 2, h / 2, 0];
    vd.normals = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1];
    vd.uvs = [0, 0, 1, 0, 1, 1, 0, 1];
    vd.indices = [0, 2, 1, 0, 3, 2];
    vd.applyToMesh(mesh);
    mesh.metadata = { uvDone: true };
    return mesh;
  }

  disc(radius, { sides = 72, arc = 1 } = {}) {
    const m = MeshBuilder.CreateDisc('disc', { radius, tessellation: sides, arc, sideOrientation: Mesh.DOUBLESIDE }, this.scene);
    m.rotation.x = Math.PI / 2;
    m.bakeCurrentTransformIntoVertices();
    return m;
  }

  torus(radius, thickness, { sides = 48 } = {}) {
    const m = MeshBuilder.CreateTorus('torus', { diameter: radius * 2, thickness, tessellation: sides }, this.scene);
    return m;
  }

  builder(name) { return new Builder(this, name); }
}

function scaleUV(mesh, su, sv) {
  const uv = mesh.getVerticesData(VertexBuffer.UVKind);
  if (!uv) return;
  for (let i = 0; i < uv.length; i += 2) { uv[i] *= su; uv[i + 1] *= sv; }
  mesh.setVerticesData(VertexBuffer.UVKind, uv);
}

// Re-project UVs in feet along each vertex's dominant normal axis. Run AFTER the mesh's
// transform has been baked, so the texture is laid out in the prop's own frame.
function boxProjectUV(mesh, tile) {
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind);
  const nrm = mesh.getVerticesData(VertexBuffer.NormalKind);
  const uv = new Float32Array((pos.length / 3) * 2);
  for (let i = 0, j = 0; i < pos.length; i += 3, j += 2) {
    const ax = Math.abs(nrm[i]); const ay = Math.abs(nrm[i + 1]); const az = Math.abs(nrm[i + 2]);
    if (ay >= ax && ay >= az) { uv[j] = pos[i] / tile; uv[j + 1] = pos[i + 2] / tile; }
    else if (ax >= az) { uv[j] = pos[i + 2] / tile; uv[j + 1] = pos[i + 1] / tile; }
    else { uv[j] = pos[i] / tile; uv[j + 1] = pos[i + 1] / tile; }
  }
  mesh.setVerticesData(VertexBuffer.UVKind, uv);
}

// Collects placed solids per material and merges each material's batch into one mesh.
export class Builder {
  constructor(kit, name) {
    this.kit = kit;
    this.name = name;
    this.groups = new Map();
    this.extras = [];
  }

  // place a solid. pos: [x,y,z]; rot: [rx,ry,rz] radians (applied Y then X then Z, Babylon's
  // own order); `quat` overrides rot; `scale` is a number or [x,y,z].
  add(mesh, material, { pos = [0, 0, 0], rot, quat, scale, uvRot = false } = {}) {
    mesh.position.set(pos[0], pos[1], pos[2]);
    if (quat) mesh.rotationQuaternion = quat;
    else if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
    if (scale !== undefined) {
      if (typeof scale === 'number') mesh.scaling.setAll(scale); else mesh.scaling.set(scale[0], scale[1], scale[2]);
    }
    mesh.bakeCurrentTransformIntoVertices();
    const meta = material.metadata || {};
    if (!meta.flat && !meta.keepUV && !mesh.metadata?.uvDone) boxProjectUV(mesh, meta.tile || 4);
    else if (!meta.flat && !meta.keepUV && mesh.metadata?.uvDone && meta.tile) { /* authored in feet already */ }
    if (uvRot) {
      const uv = mesh.getVerticesData(VertexBuffer.UVKind);
      for (let i = 0; i < uv.length; i += 2) { const t = uv[i]; uv[i] = uv[i + 1]; uv[i + 1] = t; }
      mesh.setVerticesData(VertexBuffer.UVKind, uv);
    }
    if (!mesh.getVerticesData(VertexBuffer.UVKind)) mesh.setVerticesData(VertexBuffer.UVKind, new Float32Array((mesh.getTotalVertices()) * 2));
    // Strip anything that would stop a merge (colours, tangents, second UV sets).
    const keep = [VertexBuffer.PositionKind, VertexBuffer.NormalKind, VertexBuffer.UVKind];
    if (meta.vertexColors) {
      keep.push(VertexBuffer.ColorKind);
      // every mesh in a batch must carry the attribute or the merge refuses the lot
      if (!mesh.isVerticesDataPresent(VertexBuffer.ColorKind)) mesh.setVerticesData(VertexBuffer.ColorKind, new Float32Array(mesh.getTotalVertices() * 4).fill(1));
    }
    for (const kind of mesh.getVerticesDataKinds()) {
      if (!keep.includes(kind)) mesh.removeVerticesData(kind);
    }
    if (!this.groups.has(material)) this.groups.set(material, []);
    this.groups.get(material).push(mesh);
    return this;
  }

  // Attach something that must stay its own node (a light, a pre-merged mesh).
  attach(node) { this.extras.push(node); return this; }

  // -> TransformNode with one child mesh per material. metadata.casters lists the meshes
  // that should cast shadows.
  finish({ castShadows = true, receiveShadows = true } = {}) {
    const root = new TransformNode(this.name, this.kit.scene);
    const casters = [];
    for (const [material, meshes] of this.groups) {
      const merged = meshes.length === 1 ? meshes[0] : Mesh.MergeMeshes(meshes, true, true, undefined, false, false);
      if (!merged) continue;
      merged.name = `${this.name}:${material.name.slice(0, 24)}`;
      merged.material = material;
      merged.parent = root;
      merged.receiveShadows = receiveShadows;
      if (material.metadata?.vertexColors) merged.useVertexColors = true;
      merged.isPickable = true;
      const transparent = material.alpha < 1;
      if (castShadows && !transparent) casters.push(merged);
    }
    for (const node of this.extras) node.parent = root;
    root.metadata = { casters };
    return root;
  }
}

export { Matrix, Quaternion, Vector3 };
