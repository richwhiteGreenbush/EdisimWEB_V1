// Real grass: tens of thousands of blade tufts, as geometry, around the student.
//
// A photographic lawn texture is convincing from forty feet and a green carpet from four.
// What fixes the near field is actual blades standing up out of it, and the way to afford
// them is THIN INSTANCES: one tuft mesh, one draw call, and a buffer of matrices. The field
// is not the whole world -- it is a disc around the camera, re-scattered when the student
// has walked a few feet -- and every position comes from a HASHED LATTICE, so a tuft is at
// the same spot every time that patch of ground comes back into range. Blades shrink into
// the ground toward the edge of the disc, where the lawn texture underneath takes over, so
// there is no visible boundary to walk toward.
//
// The scatter reads the terrain's painted mask, so paths, pond beds and building floors stay
// bare, and thins out on worn ground. Blades sway in the vertex shader, part around the
// student's feet, and take their normal from the GROUND rather than from the blade -- a
// field of blades lit by their own normals sparkles like tinsel; lit as the ground they
// stand on, they read as one soft surface with depth.

import { Mesh, VertexData, Matrix, Vector3, Quaternion, Color3 } from '@babylonjs/core';
import { PBRCustomMaterial } from '@babylonjs/materials';
import { WORLD_BOUND_RADIUS } from '../config.js';

const BOUND2 = (WORLD_BOUND_RADIUS + 60) * (WORLD_BOUND_RADIUS + 60);

function hash(ix, iz, k) {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(k, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// One tuft: `blades` tapered, curved blades fanned about the origin. uv.y is the height
// fraction along the blade, which the shader uses as the sway and colour weight.
function tuftGeometry(blades, seedBase, flower) {
  const p = []; const n = []; const uv = []; const idx = []; const col = [];
  const SEG = 3;
  for (let b = 0; b < blades; b++) {
    const r1 = hash(b, seedBase, 1); const r2 = hash(b, seedBase, 2); const r3 = hash(b, seedBase, 3);
    const az = (b / blades) * Math.PI * 2 + r1 * 1.4;
    const lean = 0.25 + r2 * 0.75;
    const len = 0.55 + r3 * 0.55;
    const width = 0.02 + r1 * 0.014;
    const ox = Math.cos(az * 1.7) * 0.42 * r2; const oz = Math.sin(az * 2.3) * 0.42 * r3;
    const dx = Math.cos(az); const dz = Math.sin(az);
    const sx = -dz; const sz = dx; // blade's width axis
    const base = p.length / 3;
    for (let s = 0; s <= SEG; s++) {
      const t = s / SEG;
      const bend = lean * t * t;
      const cx = ox + dx * bend * len; const cy = (t - bend * bend * 0.35) * len; const cz = oz + dz * bend * len;
      const w = width * (1 - t * 0.92);
      p.push(cx - sx * w, cy, cz - sz * w, cx + sx * w, cy, cz + sz * w);
      // Ground-ish normal, tipped a little along the blade so the tuft has some form.
      const nx = dx * 0.25 * t; const nz = dz * 0.25 * t; const l = Math.hypot(nx, 1, nz);
      n.push(nx / l, 1 / l, nz / l, nx / l, 1 / l, nz / l);
      uv.push(0, t, 1, t);
      // ALPHA carries the height fraction along the blade (and 2.0 marks a petal). The uv
      // attribute is only declared when a material samples a texture, and this one does not,
      // whereas vertex colour is always there once the mesh has it.
      col.push(1, 1, 1, t, 1, 1, 1, t);
    }
    for (let s = 0; s < SEG; s++) {
      const a = base + s * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  if (flower) {
    // A stalk and a five-petal head. uv.x > 1.5 marks petal vertices for the shader.
    const base = p.length / 3;
    const h = 1.15;
    p.push(-0.012, 0, 0, 0.012, 0, 0, -0.008, h, 0, 0.008, h, 0);
    n.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
    uv.push(0, 0, 1, 0, 0, 0.9, 1, 0.9);
    col.push(1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0.9, 1, 1, 1, 0.9);
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    const c = p.length / 3;
    p.push(0, h + 0.02, 0); n.push(0, 1, 0); uv.push(3, 1); col.push(1, 0.85, 0.3, 3);
    const petals = 10;
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * Math.PI * 2;
      const r = i % 2 === 0 ? 0.17 : 0.07;
      p.push(Math.cos(a) * r, h + (i % 2 === 0 ? 0.05 : 0.0), Math.sin(a) * r);
      n.push(0, 1, 0); uv.push(2, 1); col.push(1, 1, 1, 3);
    }
    for (let i = 0; i < petals; i++) idx.push(c, c + 1 + i, c + 1 + ((i + 1) % petals));
  }
  return { p, n, uv, idx, col };
}

// A ground-fern rosette, as geometry with its own vertex colour: fronds that rise and arch over,
// each a rachis with raked leaflets either side. Scattered by the hundred through a forest floor.
function fernGeometry() {
  const p = []; const n = []; const uv = []; const idx = []; const col = [];
  const FRONDS = 7; const SEG = 9;
  for (let f = 0; f < FRONDS; f++) {
    const az = (f / FRONDS) * Math.PI * 2 + hash(f, 3, 1) * 0.7;
    const len = 1.5 + hash(f, 3, 2) * 0.8;
    const dx = Math.cos(az); const dz = Math.sin(az); const sx = -dz; const sz = dx;
    let x = 0; let y = 0.02; let z = 0;
    const pts = [];
    for (let s = 0; s <= SEG; s++) {
      const t = s / SEG; const e = 1.15 - t * 1.55;
      pts.push([x, y, z, t]);
      x += dx * Math.cos(e) * len / SEG; y += Math.sin(e) * len / SEG; z += dz * Math.cos(e) * len / SEG;
    }
    for (let s = 0; s < SEG; s++) {
      const [ax, ay, az2, t] = pts[s]; const [bx, by, bz] = pts[s + 1];
      const w = 0.42 * Math.pow(Math.sin(Math.PI * (0.1 + t * 0.9)), 0.8);
      const g = 0.16 + 0.34 * t; const shade = 0.75 + hash(f, s, 5) * 0.35;
      for (const side of [-1, 1]) {
        const base = p.length / 3;
        p.push(ax, ay, az2, bx, by, bz, ax + sx * side * w + dx * 0.16, ay + w * 0.18, az2 + sz * side * w + dz * 0.16);
        for (let k = 0; k < 3; k++) { n.push(sx * side * 0.25, 0.95, sz * side * 0.25); uv.push(0, 0); }
        col.push(0.07 * shade, g * shade, 0.04 * shade, 2 + t, 0.07 * shade, g * shade, 0.04 * shade, 2 + t, 0.12 * shade, (g + 0.12) * shade, 0.05 * shade, 2 + t);
        idx.push(base, base + 1, base + 2);
      }
    }
  }
  return { p, n, uv, idx, col };
}

// A tussock: one crown, a fountain of long blades, straw at the tips.
function tussockGeometry() {
  const p = []; const n = []; const uv = []; const idx = []; const col = [];
  const BLADES = 34; const SEG = 3;
  for (let b = 0; b < BLADES; b++) {
    const az = hash(b, 5, 1) * Math.PI * 2; const lean = 0.35 + hash(b, 5, 2) * 0.95; const len = 1.2 + hash(b, 5, 3) * 1.1;
    const dx = Math.cos(az); const dz = Math.sin(az); const sx = -dz; const sz = dx; const w0 = 0.03;
    const base = p.length / 3;
    for (let s = 0; s <= SEG; s++) {
      const t = s / SEG; const bend = lean * t * t;
      const cx = dx * (0.08 + bend * len); const cy = (t - bend * bend * 0.3) * len; const cz = dz * (0.08 + bend * len);
      const w = w0 * (1 - t * 0.85);
      p.push(cx - sx * w, cy, cz - sz * w, cx + sx * w, cy, cz + sz * w);
      n.push(dx * 0.2, 1, dz * 0.2, dx * 0.2, 1, dz * 0.2); uv.push(0, t, 1, t);
      const r = 0.16 + 0.5 * t; const g = 0.17 + 0.36 * t; const bl = 0.05 + 0.1 * t;
      col.push(r, g, bl, 2 + t, r, g, bl, 2 + t);
    }
    for (let s = 0; s < SEG; s++) { const a = base + s * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  return { p, n, uv, idx, col };
}

// A loose stone: a squashed, faceted ball with its own normals (so the sun models it) and a
// dusty top. Scattered by the thousand across regolith, this is what turns a textured plain
// into GROUND -- real surfaces are littered at every scale, and a clean one reads as a render.
function stoneGeometry() {
  // Built as a lumpy ball, then emitted FACE BY FACE with face normals: a stone this size is
  // angular, and a smooth-shaded one reads as a jellybean however it is coloured.
  const RINGS = 5; const SIDES = 8;
  const grid = [];
  for (let j = 0; j <= RINGS; j++) {
    const phi = (j / RINGS) * Math.PI; const row = [];
    for (let i = 0; i < SIDES; i++) {
      const th = ((i + (j % 2) * 0.5) / SIDES) * Math.PI * 2;
      const pole = j === 0 || j === RINGS;
      // Lumpy, not shattered: too much variation on so coarse a ball turns each face into a
      // separate shard and the stone reads as a scrap of folded paper.
      const k = pole ? 0.92 : 0.82 + hash(i, j, 11) * 0.34;
      row.push([Math.sin(phi) * Math.cos(th) * k * 0.5, Math.cos(phi) * 0.36 * k + 0.13, Math.sin(phi) * Math.sin(th) * k * 0.44]);
    }
    grid.push(row);
  }
  const p = []; const n = []; const uv = []; const idx = []; const col = [];
  const tri = (A, B, C) => {
    const ux = B[0] - A[0]; const uy = B[1] - A[1]; const uz = B[2] - A[2]; const vx = C[0] - A[0]; const vy = C[1] - A[1]; const vz = C[2] - A[2];
    let nx = uy * vz - uz * vy; let ny = uz * vx - ux * vz; let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    // face outward, whichever way the grid happened to wind
    const cx = (A[0] + B[0] + C[0]) / 3; const cy = (A[1] + B[1] + C[1]) / 3 - 0.13; const cz = (A[2] + B[2] + C[2]) / 3;
    let pts = [A, B, C];
    if (nx * cx + ny * cy + nz * cz < 0) { nx = -nx; ny = -ny; nz = -nz; pts = [A, C, B]; }
    const base = p.length / 3;
    // dust on what faces up, shadowed rock on what faces down; a little per-face variation
    const c = (0.34 + Math.max(0, ny) * 0.5) * (0.85 + hash(base, 3, 7) * 0.3);
    for (const q of pts) { p.push(q[0], q[1], q[2]); n.push(nx, ny, nz); uv.push(0, 0); col.push(c, c, c, 5); }
    idx.push(base, base + 2, base + 1); // Babylon culls left-handed even in a right-handed scene
  };
  for (let j = 0; j < RINGS; j++) for (let i = 0; i < SIDES; i++) {
    const i2 = (i + 1) % SIDES;
    tri(grid[j][i], grid[j + 1][i], grid[j][i2]);
    tri(grid[j][i2], grid[j + 1][i], grid[j + 1][i2]);
  }
  return { p, n, uv, idx, col };
}

const UNDERGROWTH = {
  // kind: [geometry, patch threshold, chance, scale range, instance palette]
  flowers: { make: () => tuftGeometry(3, 11, true), patch: 0.7, chance: 0.05, scale: [0.8, 1.7], palette: [[1, 0.86, 0.2], [1, 1, 1], [0.78, 0.5, 1], [1, 0.45, 0.62], [0.45, 0.62, 1], [1, 0.62, 0.22]] },
  // Ferns gather in DRIFTS (a high patch threshold) rather than carpeting the floor, and the
  // mesh is swapped at boot for a textured rosette -- see useMesh(). cpuFade: that material has
  // no distance fade of its own, so instances are shrunk toward the edge of the ring here.
  ferns: { make: fernGeometry, patch: 0.56, chance: 0.035, scale: [0.6, 1.5], cpuFade: true, palette: [[1, 1, 1], [0.8, 0.95, 0.8], [1.1, 1.0, 0.75], [0.7, 0.85, 0.7]] },
  // Stones take the ground's own colour as their instance tint (set from the theme).
  rocks: { make: stoneGeometry, patch: 0.22, chance: 0.075, scale: [0.16, 1.9], skew: true, palette: [[1, 1, 1], [0.8, 0.8, 0.8], [1.15, 1.12, 1.1], [0.62, 0.62, 0.62]] },
  tussocks: { make: tussockGeometry, patch: 0.3, chance: 0.06, scale: [0.7, 1.5], palette: [[1, 1, 1], [1.1, 1.0, 0.8], [0.85, 0.95, 0.8]] },
};

export class Grass {
  constructor(scene, terrain, quality) {
    this.scene = scene;
    this.terrain = terrain;
    this.quality = quality;
    this.time = 0;
    this.centre = { x: 1e9, z: 1e9 };
    this.enabled = false;
    this.player = new Vector3(0, 0, 0);

    this.grassMesh = this.makeMesh('grassTufts', tuftGeometry(11, 7, false));
    // One undergrowth mesh per KIND, all sharing the flower material; a theme picks which is live.
    this.under = {};
    for (const [kind, u] of Object.entries(UNDERGROWTH)) this.under[kind] = this.makeMesh(`undergrowth-${kind}`, u.make());
    this.flowerMesh = this.under.flowers;
    this.grassMat = this.makeMaterial('grassMat', false);
    this.flowerMat = this.makeMaterial('flowerMat', true);
    this.grassMesh.material = this.grassMat;
    for (const m of Object.values(this.under)) m.material = this.flowerMat;
  }

  // Replace a kind's scatter mesh with one built elsewhere (it needs the prop kit, which the
  // engine layer does not have).
  useMesh(kind, mesh) {
    this.under[kind]?.dispose();
    mesh.isPickable = false; mesh.receiveShadows = true; mesh.alwaysSelectAsActiveMesh = true;
    mesh.setEnabled(kind === this.underKind);
    this.under[kind] = mesh;
    if (kind === this.underKind) this.flowerMesh = mesh;
    this.invalidate();
  }

  makeMesh(name, g) {
    const mesh = new Mesh(name, this.scene);
    const vd = new VertexData();
    vd.positions = g.p; vd.normals = g.n; vd.uvs = g.uv; vd.indices = g.idx; vd.colors = g.col;
    vd.applyToMesh(mesh);
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    mesh.alwaysSelectAsActiveMesh = true; // the instance cloud has no meaningful bounds
    mesh.setEnabled(false);
    return mesh;
  }

  makeMaterial(name, flower) {
    const mat = new PBRCustomMaterial(name, this.scene);
    mat.metallic = 0;
    mat.roughness = 0.78;
    mat.backFaceCulling = false;
    mat.twoSidedLighting = false;
    mat.albedoColor = Color3.White();
    mat.environmentIntensity = 0.8;
    mat.specularIntensity = 0.4;
    mat.AddUniform('gTime', 'float', 0);
    mat.AddUniform('gRadius', 'float', 80);
    mat.AddUniform('gPlayer', 'vec3', new Vector3());
    mat.AddUniform('gRoot', 'vec3', new Vector3(0.3, 0.5, 0.12));
    mat.AddUniform('gTip', 'vec3', new Vector3(0.6, 0.8, 0.3));
    mat.AddUniform('gWind', 'float', 1);
    mat.Vertex_Definitions('varying float vBladeT; varying float vPetal;');
    mat.Vertex_After_WorldPosComputed(`
      // alpha < 1.5: a grass blade, alpha IS the height fraction. alpha >= 2: a part that keeps its
      // own vertex colour (a petal, a fern frond, a tussock), height fraction = alpha - 2.
      vPetal = step(1.5, color.a);
      vBladeT = color.a > 1.5 ? clamp(color.a - 2.0, 0.0, 1.0) : min(color.a, 1.0);
      // alpha >= 4: RIGID. A scattered stone is shaded at full brightness and never sways,
      // parts or bends -- everything below that moves is multiplied by this.
      float gSoft = 1.0 - step(3.5, color.a);
      vec3 gBase = (finalWorld * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      float gW = vBladeT * vBladeT * gSoft;
      float gPh = gBase.x * 0.19 + gBase.z * 0.23;
      float gGust = 0.55 + 0.45 * sin(gTime * 0.42 + gBase.x * 0.021 + gBase.z * 0.017);
      worldPos.x += (sin(gTime * 1.9 + gPh) * 0.16 + sin(gTime * 5.3 + gPh * 2.3) * 0.04) * gW * gGust * gWind;
      worldPos.z += (cos(gTime * 1.6 + gPh * 1.2) * 0.13 + cos(gTime * 4.7 + gPh * 1.9) * 0.04) * gW * gGust * gWind;
      // Part around the student's feet. The epsilon matters: normalize(vec2(0)) is NaN, and
      // one NaN vertex takes the whole instanced mesh off screen.
      vec2 gAway = gBase.xz - gPlayer.xz;
      float gD = length(gAway);
      float gPush = (1.0 - smoothstep(0.6, 3.2, gD)) * gW;
      worldPos.xz += (gAway / (gD + 0.001)) * gPush * 0.9;
      worldPos.y -= gPush * 0.35;
      // Sink into the ground toward the edge of the scattered disc.
      float gFade = smoothstep(gRadius * 0.62, gRadius * 0.98, length(gBase.xz - vEyePosition.xz));
      worldPos.xyz = mix(worldPos.xyz, vec3(worldPos.x, gBase.y - 0.05, worldPos.z), gFade);
    `);
    mat.Fragment_Definitions('varying float vBladeT; varying float vPetal;');
    mat.Fragment_Before_Lights(`
      vec3 gCol = mix(gRoot, gTip, vBladeT * vBladeT);
      // Ambient occlusion down in the thatch: blades are darkest where they are densest.
      gCol *= mix(0.62, 1.0, smoothstep(0.0, 0.55, vBladeT));
      ${flower ? 'surfaceAlbedo = mix(gCol * vec3(0.8, 1.0, 0.7), surfaceAlbedo * mix(0.5, 1.0, smoothstep(0.0, 0.6, vBladeT)), vPetal);' : 'surfaceAlbedo = gCol * surfaceAlbedo;'}
    `);
    mat.onBindObservable.add(() => {
      const e = mat.getEffect();
      if (!e) return;
      e.setFloat('gTime', this.time);
      e.setFloat('gRadius', this.radius ?? 80);
      e.setVector3('gPlayer', this.player);
      e.setFloat('gWind', this.wind ?? 1);
      if (this.rootColor) { e.setVector3('gRoot', this.rootColor); e.setVector3('gTip', this.tipColor); }
    });
    return mat;
  }

  applyTheme(theme) {
    this.enabled = !!theme.grass;
    // A theme can ask for the scatter WITHOUT the blades: a regolith plain has stones, no grass.
    this.blades = this.enabled && theme.grass.blades !== false;
    this.grassMesh.setEnabled(this.blades);
    this.underTint = theme.grass?.tint ?? [1, 1, 1];
    const kind = !this.enabled ? null : theme.grass.undergrowth === undefined ? (theme.grass.flowers ? 'flowers' : null) : theme.grass.undergrowth;
    for (const [k, m] of Object.entries(this.under)) m.setEnabled(k === kind);
    this.underKind = kind;
    this.flowerMesh = kind ? this.under[kind] : this.under.flowers;
    if (!this.enabled) return;
    this.meadow = theme.grass.meadow ?? 1;
    this.bladeHeight = theme.grass.height;
    this.rootColor = new Vector3(...theme.grass.color);
    this.tipColor = new Vector3(...theme.grass.tip);
    this.centre = { x: 1e9, z: 1e9 };
  }

  invalidate() { this.centre = { x: 1e9, z: 1e9 }; }

  update(dt, px, pz, py) {
    this.time += dt;
    this.player.set(px, py, pz);
    if (!this.enabled) return;
    if (Math.hypot(px - this.centre.x, pz - this.centre.z) > 7) this.scatter(px, pz);
  }

  scatter(px, pz) {
    this.centre = { x: px, z: pz };
    const R = this.quality.grassRadius;
    this.radius = R;
    const cell = 0.82 / Math.sqrt(this.quality.grassDensity);
    const terrain = this.terrain;
    const x0 = Math.floor((px - R) / cell); const x1 = Math.ceil((px + R) / cell);
    const z0 = Math.floor((pz - R) / cell); const z1 = Math.ceil((pz + R) / cell);
    const max = (x1 - x0 + 1) * (z1 - z0 + 1);
    const grass = new Float32Array(max * 16); const gcol = new Float32Array(max * 4);
    const flowers = new Float32Array((max >> 3) * 16); const fcol = new Float32Array((max >> 3) * 4);
    let g = 0; let f = 0;
    const m = new Matrix(); const q = new Quaternion(); const s = new Vector3(); const t = new Vector3();
    const R2 = (R + 6) * (R + 6);
    const U = UNDERGROWTH[this.underKind ?? 'flowers'];
    const PALETTE = U.palette;
    for (let iz = z0; iz <= z1; iz++) {
      for (let ix = x0; ix <= x1; ix++) {
        const x = (ix + hash(ix, iz, 1)) * cell; const z = (iz + hash(ix, iz, 2)) * cell;
        const dx = x - px; const dz = z - pz;
        if (dx * dx + dz * dz > R2) continue;
        if (x * x + z * z > BOUND2) continue;
        const mask = terrain.maskAt(x, z);
        const bare = Math.max(mask[0], mask[2]);
        if (bare > (this.blades ? 0.22 : 0.6)) continue;
        const r3 = hash(ix, iz, 3);
        if (r3 < mask[1] * 0.85) continue; // thin out on worn ground
        const y = terrain.heightAt(x, z);
        // Meadow patches: broad noise picks where the grass is long and where it is lawn.
        const patch = 0.5 + 0.5 * Math.sin(x * 0.043 + 1.3) * Math.cos(z * 0.037 - 0.4) + (hash(ix >> 3, iz >> 3, 9) - 0.5) * 0.5;
        // Mostly mown lawn; long only in the meadow patches.
        const meadow = Math.max(0, patch - 0.55) * 2.2;
        const tall = 0.8 + meadow * meadow * 1.1 * (this.meadow ?? 1);
        const hgt = this.bladeHeight * tall * (0.7 + r3 * 0.6);
        Quaternion.RotationYawPitchRollToRef(hash(ix, iz, 4) * 6.283, 0, 0, q);
        s.set(1 + r3 * 0.4, hgt, 1 + r3 * 0.4); t.set(x, y - 0.03, z);
        Matrix.ComposeToRef(s, q, t, m);
        if (this.blades) m.copyToArray(grass, g * 16);
        // Per-tuft tint: lush to dry, so the field is never one flat green.
        const dry = hash(ix, iz, 5);
        gcol[g * 4] = 0.8 + dry * 0.5; gcol[g * 4 + 1] = 0.85 + hash(ix, iz, 6) * 0.3; gcol[g * 4 + 2] = 0.7 + dry * 0.4; gcol[g * 4 + 3] = 1;
        if (this.blades) g++;
        if (this.underKind && patch > U.patch && hash(ix, iz, 7) < U.chance && f < (max >> 3) - 1) {
          // `skew` cubes the roll: many pebbles, a few cobbles, the odd small boulder -- the size
          // distribution of real debris, where an even spread reads as a gravel delivery.
          let roll = hash(ix, iz, 8); if (U.skew) roll = roll * roll * roll;
          let us = U.scale[0] + roll * (U.scale[1] - U.scale[0]);
          if (U.cpuFade) { const dd = Math.sqrt(dx * dx + dz * dz) / R; us *= 1 - Math.min(1, Math.max(0, (dd - 0.72) / 0.28)); if (us < 0.05) continue; }
          if (this.underKind === 'flowers') s.set(1, us, 1); else s.set(us, us, us);
          Matrix.ComposeToRef(s, q, t, m);
          m.copyToArray(flowers, f * 16);
          const c = PALETTE[Math.floor(hash(ix >> 2, iz >> 2, 10) * PALETTE.length)];
          const ut = this.underTint;
          fcol[f * 4] = c[0] * ut[0]; fcol[f * 4 + 1] = c[1] * ut[1]; fcol[f * 4 + 2] = c[2] * ut[2]; fcol[f * 4 + 3] = 1;
          f++;
        }
      }
    }
    this.grassMesh.thinInstanceSetBuffer('matrix', grass.subarray(0, g * 16), 16, false);
    this.grassMesh.thinInstanceSetBuffer('color', gcol.subarray(0, g * 4), 4, false);
    this.flowerMesh.thinInstanceSetBuffer('matrix', flowers.subarray(0, f * 16), 16, false);
    this.flowerMesh.thinInstanceSetBuffer('color', fcol.subarray(0, f * 4), 4, false);
    this.count = g;
  }
}
