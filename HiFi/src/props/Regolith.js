// Rocks and craters for The Moon and On Mars.
//
// The main app's are a handful of roughened icosahedra and a 48-sided lathe, flat-shaded in
// four greys. Here a rock is a FRACTURED solid (see Kit.rock's `facets`) in a 2K photographic
// rock set, and it carries DUST: regolith settles on whatever faces up, so every upward face is
// lifted toward the colour of the ground the rock is sitting on, and the underside and the
// fracture faces stay dark. That one gradient is most of what stops a boulder looking as if it
// was placed on the surface a moment ago.
//
// PLACEMENT IS THE MAIN APP'S, DRAW FOR DRAW. The three.js rocks are still what gets clicked, so
// the native field replays the original builder's random sequence -- same generator, same order
// of draws -- and every native boulder stands exactly where its pickable twin is. Extra rubble
// (which nobody needs to click) is scattered from a second generator afterwards.

import { VertexBuffer, VertexData } from '@babylonjs/core';
import { seededRandom as appRandom, randomIn } from '../../../src/PropKit.js';
import { seededRandom, linear } from './Kit.js';

const WORLDS = {
  moon: { set: 'Rock030', grey: true, gain: 1.9, rock: 0x77756f, dust: 0xb9b6ae, regolith: 'Ground054', regolithGain: 1.05, regolithTint: 0x8f8d88 },
  mars: { set: 'Rock030', grey: true, gain: 2.0, rock: 0x8a4a30, dust: 0xc9825a, regolith: 'Ground054', regolithGain: 1.0, regolithTint: 0xb0623a },
};

// Writes the dust gradient into a mesh's vertex colours from its own normals.
function dust(mesh, rockHex, dustHex, seed, { floor = 0.3, top = 0.85 } = {}) {
  const nrm = mesh.getVerticesData(VertexBuffer.NormalKind);
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind);
  const rock = linear(rockHex); const dustC = linear(dustHex);
  const col = new Float32Array((nrm.length / 3) * 4);
  const rand = seededRandom(seed + 1);
  const ph = [rand() * 6, rand() * 6];
  for (let i = 0, j = 0; i < nrm.length; i += 3, j += 4) {
    // patchy, not a clean contour: dust pools, and slides off steeper ground
    const wobble = Math.sin(pos[i] * 3.1 + ph[0]) * Math.cos(pos[i + 2] * 2.7 + ph[1]) * 0.18;
    let t = (nrm[i + 1] + wobble - floor) / (top - floor);
    t = Math.min(1, Math.max(0, t)); t = t * t * (3 - 2 * t);
    const under = nrm[i + 1] < -0.1 ? 0.62 : 1; // the underside never sees the sun or the dust
    col[j] = (rock.r + (dustC.r - rock.r) * t) * under;
    col[j + 1] = (rock.g + (dustC.g - rock.g) * t) * under;
    col[j + 2] = (rock.b + (dustC.b - rock.b) * t) * under;
    col[j + 3] = 1;
  }
  mesh.setVerticesData(VertexBuffer.ColorKind, col);
  return mesh;
}

function rocks(world) {
  const W = WORLDS[world];
  return (kit, { count = 9, spread = 9, scale = 1, seed = 23 } = {}) => {
    const b = kit.builder(`${world}-rocks`);
    const mat = kit.mat(W.set, { grey: W.grey, gain: W.gain, tile: 4.5, bump: 1.7, vertexColors: true });
    const rng = appRandom(seed);
    for (let i = 0; i < count; i++) {
      // the main app's draws, in the main app's order
      const size = randomIn(rng, 0.35, 1.5) * scale;
      const flatten = randomIn(rng, 0.62, 0.9);
      const angle = rng() * Math.PI * 2;
      const distance = Math.sqrt(rng()) * spread;
      const rot = [randomIn(rng, 0, 1), randomIn(rng, 0, 6.28), randomIn(rng, 0, 1)];
      rng(); // its colour pick
      const big = size > 0.9 * scale;
      const rock = kit.rock(size * 1.08, seed * 31 + i, { segments: big ? 40 : 26, squash: flatten, rough: 0.2, facets: big ? 11 : 7 });
      dust(rock, W.rock, W.dust, seed + i);
      // Sunk a little: a boulder that has sat for a billion years is part-buried, not balanced.
      b.add(rock, mat, { pos: [Math.cos(angle) * distance, size * flatten * 0.42, Math.sin(angle) * distance], rot: [rot[0] * 0.3, rot[1], rot[2] * 0.3] });
    }
    // rubble: the small stuff that always lies round the big stuff
    const extra = seededRandom(seed * 7 + 3);
    const n = Math.round(count * 5);
    for (let i = 0; i < n; i++) {
      const a = extra() * Math.PI * 2; const d = Math.sqrt(extra()) * spread * 1.15;
      const s = (0.07 + extra() * extra() * 0.3) * scale;
      const pebble = kit.rock(s, seed * 53 + i, { segments: 8, squash: 0.6 + extra() * 0.3, rough: 0.25, facets: 5 });
      dust(pebble, W.rock, W.dust, seed + 100 + i);
      b.add(pebble, mat, { pos: [Math.cos(a) * d, s * 0.25, Math.sin(a) * d], rot: [0, extra() * 6.28, 0] });
    }
    const root = b.finish();
    root.metadata.instanceable = false;
    return root;
  };
}

// A crater, on the main app's own profile (so it occupies the same ground and the same height)
// but at several times the resolution, with a rim that varies round its circumference the way a
// real one does -- slumped here, sharp there -- terraced inner walls, a hummocky ejecta apron
// fading outward, and a ring of thrown blocks. Rim crest and ejecta are bright (freshly turned
// regolith is paler than the weathered surface) and the floor is dark.
function crater(world) {
  const W = WORLDS[world];
  return (kit, { radius = 14, rimHeight = 1.6, seed = 11 } = {}) => {
    const b = kit.builder(`${world}-crater`);
    // The bowl is built SEPARATELY and never casts. It is a double-sided lathe, so as a caster its
    // own underside shadows its own top: under the Moon's near-zero ambient the whole crater
    // renders black (dark brown on Mars, where there is some fill). The main app switches crater
    // shadows off for the same reason. Its thrown blocks still cast, which is what grounds them.
    const bowlBuilder = kit.builder(`${world}-crater-bowl`);
    // NO tint here: the vertex colours already ARE the regolith's colour. A tint as well squares
    // it -- 0.15 x 0.75 in red, 0.02 x 0.07 in blue -- and the crater renders black, which looks
    // exactly like a shadow or a normals bug and is neither.
    const ground = kit.mat(W.regolith, { grey: W.grey, gain: W.regolithGain * 2.3, tile: 9, bump: 1.5, vertexColors: true });
    const rockMat = kit.mat(W.set, { grey: W.grey, gain: W.gain, tile: 4.5, bump: 1.7, vertexColors: true });
    const rand = seededRandom(seed * 13 + 1);
    // the app's profile, as [r/radius, y], resampled smooth
    const P = [[0, 0.03], [0.2, 0.0], [0.35, 0.0], [0.5, 0.1], [0.6, 0.22], [0.7, rimHeight * 0.42], [0.78, rimHeight * 0.72], [0.85, rimHeight * 0.93],
      [0.9, rimHeight], [0.95, rimHeight * 0.62], [1.0, rimHeight * 0.3], [1.14, rimHeight * 0.12], [1.35, 0.03], [1.6, -0.06]];
    const profile = [];
    const RINGS = 46;
    for (let i = 0; i <= RINGS; i++) {
      const f = (i / RINGS) * (P.length - 1); const k = Math.min(P.length - 2, Math.floor(f)); const t = f - k;
      const s = t * t * (3 - 2 * t);
      profile.push([(P[k][0] + (P[k + 1][0] - P[k][0]) * s) * radius, P[k][1] + (P[k + 1][1] - P[k][1]) * s]);
    }
    const bowl = kit.lathe(profile, { sides: 128, tile: 9 });
    const pos = bowl.getVerticesData(VertexBuffer.PositionKind);
    const col = new Float32Array((pos.length / 3) * 4);
    const floorC = linear(W.rock).scale(0.55); const rimC = linear(W.dust).scale(1.12); const apronC = linear(W.dust).scale(0.9);
    const ph = [rand() * 6, rand() * 6, rand() * 6];
    for (let i = 0, j = 0; i < pos.length; i += 3, j += 4) {
      const x = pos[i]; const z = pos[i + 2]; const r = Math.hypot(x, z) / radius; const a = Math.atan2(z, x);
      // rim height varies round the circle; every frequency is a whole number of cycles, so the
      // seam closes
      const vary = 1 + Math.sin(a * 2 + ph[0]) * 0.2 + Math.sin(a * 5 + ph[1]) * 0.12 + Math.sin(a * 11 + ph[2]) * 0.06;
      const onRim = Math.exp(-Math.pow((r - 0.9) / 0.2, 2));
      const hummock = Math.sin(x * 0.9 + ph[1]) * Math.cos(z * 1.1 + ph[2]) * 0.09 * Math.max(0, r - 0.95);
      const terrace = r > 0.55 && r < 0.86 ? Math.sin(r * 38) * 0.05 * rimHeight : 0;
      pos[i + 1] = pos[i + 1] * (1 + (vary - 1) * onRim) + hummock * rimHeight + terrace;
      const bright = Math.min(1, onRim * 1.1);
      const out = Math.min(1, Math.max(0, (r - 1.0) / 0.6));
      const base = r < 0.9 ? floorC : apronC;
      const c = [base.r + (rimC.r - base.r) * bright, base.g + (rimC.g - base.g) * bright, base.b + (rimC.b - base.b) * bright];
      // rays: the apron is streaked radially
      const ray = r > 0.95 ? 1 + Math.sin(a * 17 + ph[0]) * 0.1 * (1 - out) : 1;
      col[j] = c[0] * ray; col[j + 1] = c[1] * ray; col[j + 2] = c[2] * ray; col[j + 3] = 1;
    }
    bowl.setVerticesData(VertexBuffer.PositionKind, pos);
    // NOT bowl.createNormals(): that passes the scene's right-handed flag to ComputeNormals, and
    // MeshBuilder geometry is wound LEFT-handed whatever the scene is (Babylon flips culling at
    // draw time instead). With the flag every normal comes out pointing into the ground and the
    // crater is lit from underneath -- black, with no error. Kit.rock computes them this way too.
    const nrm = [];
    VertexData.ComputeNormals(pos, bowl.getIndices(), nrm);
    bowl.setVerticesData(VertexBuffer.NormalKind, nrm);
    bowl.setVerticesData(VertexBuffer.ColorKind, col);
    bowlBuilder.add(bowl, ground);
    // thrown blocks: thick on the rim, thinning through the apron
    const blocks = Math.round(radius * 2.4);
    for (let i = 0; i < blocks; i++) {
      const a = rand() * Math.PI * 2; const rr = radius * (0.82 + rand() * rand() * 0.75);
      const s = 0.18 + rand() * rand() * (radius * 0.055);
      const rock = kit.rock(s, seed * 17 + i, { segments: s > 0.5 ? 22 : 10, squash: 0.6 + rand() * 0.3, rough: 0.22, facets: s > 0.5 ? 9 : 5 });
      dust(rock, W.rock, W.dust, seed + i);
      const rn = rr / radius;
      const y = rn < 0.9 ? rimHeight * Math.max(0, (rn - 0.6) / 0.3) : rimHeight * Math.max(0, 1 - (rn - 0.9) / 0.35);
      b.add(rock, rockMat, { pos: [Math.cos(a) * rr, y * 0.85 + s * 0.2, Math.sin(a) * rr], rot: [rand() * 0.4, rand() * 6.28, rand() * 0.4] });
    }
    const root = b.finish({ castShadows: true });
    const bowlRoot = bowlBuilder.finish({ castShadows: false });
    bowlRoot.parent = root;
    // No footprint: that paints the terrain's no-grass mask, which darkens the ground to wet
    // earth -- right under a building on a lawn, a dark halo round a crater on dry regolith.
    root.metadata.instanceable = false;
    return root;
  };
}

export const REGOLITH_NATIVE = {
  'moon-rocks': rocks('moon'),
  'moon-crater': crater('moon'),
  'mars-rocks': rocks('mars'),
  'mars-crater': crater('mars'),
};
