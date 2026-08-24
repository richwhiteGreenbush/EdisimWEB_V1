import * as THREE from 'three';
import { buildBatchLoadingManager, loadModelFile, scaleToHeight } from './ModelLoader.js';
import { loadImagePlane } from './MediaLoader.js';
import { MODEL_TARGET_HEIGHT } from './config.js';
import { canvasTexture, relief, seededRandom } from './PropKit.js';

// The three assets fetched from public/: a little library building, a maple tree, and
// an image billboard. These re-fetch from their fixed URL every time (including on
// rehydrate) rather than storing file bytes in IndexedDB -- they're project assets,
// not user uploads, so there's nothing to gain from duplicating them into the
// database, and it's the only way the tree's manually-applied bark/leaf textures (it
// ships with no .mtl) survive a reload.
//
// They are no longer placed by a boot routine of their own: the Park preset world
// places them as records (visitor centre, specimen maples, welcome banner), which is
// why only the three loaders live here now. Their `startup-*` record kinds are
// unchanged, so worlds saved before the Park existed still rehydrate.

// Every url here names a file shipped in `public/`, so it must resolve RELATIVE to
// wherever the bundle is mounted -- an origin root, or /app/ on the gallery's host. A
// leading slash instead looks for it at the domain root, which under /app/ is the
// marketing site: the fetch 404s and the asset silently never appears.
//
// The strip is here rather than at each call site because this is the one funnel they all
// go through, and the failure is invisible in dev (where the app IS at a root) and shows
// up only as a missing object in production. Two of the three loaders were already
// converted by hand and the third was missed, which is precisely the argument for making
// the guard structural instead of remembering it each time.
async function fetchAsFile(url, name, type) {
  const relative = url.replace(/^\/+/, '');
  const res = await fetch(relative);
  if (!res.ok) throw new Error(`Failed to fetch ${relative}: ${res.status}`);
  const blob = await res.blob();
  return new File([blob], name, { type: type || blob.type });
}

async function loadTexture(url, { srgb = true } = {}) {
  const texture = await new THREE.TextureLoader().loadAsync(url);
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function tagShadows(object3D) {
  object3D.traverse((node) => {
    if (node.isMesh) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });
}

export async function loadLibraryModel() {
  const [objFile, mtlFile] = await Promise.all([
    fetchAsFile('library/mini-library.obj', 'mini-library.obj'),
    fetchAsFile('library/mini-library.mtl', 'mini-library.mtl'),
  ]);
  const { manager, urlMap } = buildBatchLoadingManager([objFile, mtlFile]);
  try {
    const object3D = await loadModelFile({ file: objFile, ext: 'obj', manager, mtlFile });
    scaleToHeight(object3D, MODEL_TARGET_HEIGHT);
    tagShadows(object3D);
    return object3D;
  } finally {
    for (const url of urlMap.values()) URL.revokeObjectURL(url);
  }
}

// Ships as MapleTree.obj with no accompanying .mtl -- the object names inside it
// (tree_Mesh / leaves / leaves.001, confirmed by inspecting the file) are matched
// here to the loose bark/leaf/mask textures that came with it.
export async function loadTreeModel() {
  const objFile = await fetchAsFile('tree/MapleTree.obj', 'MapleTree.obj');
  const { manager, urlMap } = buildBatchLoadingManager([objFile]);
  let object3D;
  try {
    object3D = await loadModelFile({ file: objFile, ext: 'obj', manager });
  } finally {
    for (const url of urlMap.values()) URL.revokeObjectURL(url);
  }

  const [barkTexture, leafTexture, leafMask] = await Promise.all([
    loadTexture('tree/maple_bark.png'),
    loadTexture('tree/maple_leaf.png'),
    loadTexture('tree/maple_leaf_Mask.png', { srgb: false }),
  ]);

  object3D.traverse((node) => {
    if (!node.isMesh) return;
    if (node.name === 'tree_Mesh') {
      node.material = new THREE.MeshStandardMaterial({ map: barkTexture, roughness: 0.9 });
    } else if (node.name === 'leaves' || node.name === 'leaves.001') {
      node.material = new THREE.MeshStandardMaterial({
        map: leafTexture,
        alphaMap: leafMask,
        transparent: true,
        alphaTest: 0.4,
        side: THREE.DoubleSide,
        roughness: 0.8,
      });
    }
  });

  tagShadows(object3D);
  scaleToHeight(object3D, MODEL_TARGET_HEIGHT);
  return object3D;
}

export async function loadBillboardImage() {
  const file = await fetchAsFile('NewEdusim.png', 'NewEdusim.png', 'image/png');
  return loadImagePlane(file, { isGif: false });
}

// ---------------------------------------------------------------------------
// The llama
// ---------------------------------------------------------------------------

// public/llama/llama.glb is BAKED from the supplied rigged Llama.glb by
// tools/bake-llama.mjs. The original was 1,053,804 bytes for 2,060 triangles: 26
// animation clips, a 46-joint skeleton and a pile of IK/pole-target nodes, none of
// which this app can use -- there is no AnimationMixer anywhere in it. The baker
// evaluates the skin once at the bind pose and writes plain geometry, which is
// 117,656 bytes for the same 2,060 triangles. Verified vertex by vertex against the
// original: mean normal dot 1.000000, max position error 2.7e-5 on a 5.43-unit model.
//
// It is fetched rather than stored, exactly like the maple and the little library --
// a project asset, not a student upload, so there is nothing to gain from copying its
// bytes into IndexedDB and into every exported world file. See the `startup-*` notes
// in WorldStore.rehydrateOne().
const LLAMA_URL = 'llama/llama.glb';

// The BYTES are cached and the Object3D is NOT, which is the same one-level-lower rule
// SurfaceTextures.js follows for its decoded images: PlacedRegistry.disposeObject3D()
// destroys a removed object's geometries, materials and maps outright, so a shared
// Object3D would be torn out from under every other llama the moment one is deleted.
// An ArrayBuffer is not a GPU resource and nothing disposes it, so caching the fetch is
// safe and every llama still gets its own fresh everything.
let llamaBytesPromise = null;

// The model ships as one three-tone scheme -- Main, a lighter Main_Light, and a much
// darker desaturated Main_Dark for the points. Measured off the file: Light is Main at
// +0.057 lightness with the same hue and saturation, and Dark is Main dropped to about
// 0.62 of its lightness with the saturation pulled out. Recolouring by REPRODUCING those
// two relationships rather than by picking three flat colours is what lets one file give
// a whole herd: whatever fleece a record asks for, the model's own shading survives.
//
// HSL is read and written in sRGB explicitly. Colour management is on (r152+) so the
// working space is linear-sRGB, where "lightness" is not the perceptual quantity these
// offsets were measured in -- left to the default, a white llama comes out grey.
function llamaFleeceTones(fleece) {
  const base = new THREE.Color(fleece);
  const hsl = {};
  base.getHSL(hsl, THREE.SRGBColorSpace);
  const light = new THREE.Color().setHSL(hsl.h, hsl.s, Math.min(1, hsl.l + 0.057), THREE.SRGBColorSpace);
  const dark = new THREE.Color().setHSL(hsl.h, hsl.s * 0.35, Math.max(0.05, hsl.l * 0.62), THREE.SRGBColorSpace);
  return { base, light, dark };
}

// A woven saddle blanket, draped onto the animal's ACTUAL surface by raycasting it.
//
// This is the "ask the host where its surface is" rule (RobotProps' onShell, the
// volcano's surfaceAt): hand-picked coordinates near a curved body are either floating
// or buried, the two failures look nothing alike, and hunting each one separately is the
// whole afternoon. Casting inward at every sample gives the real point and the real
// normal, so the cloth sits ON the llama whatever the model does.
//
// It is a CLOSED solid -- outer face, inner face, and a rim strip joining them all the
// way round -- because a zero-thickness sheet is invisible edge-on and leaves an open
// boundary, which is the one thing this rebuild is not allowed to do.
function llamaBlanket(meshes, texture) {
  const COLS = 26;   // round the barrel, over a 150-degree wrap
  const ROWS = 14;   // along the back
  const Z0 = -1.28, Z1 = 0.42;      // the flat of the back, measured off the model
  const SPREAD = THREE.MathUtils.degToRad(76); // half-wrap, each side of the spine
  const AXIS_Y = 2.35;               // barrel centre; the back reads at y ~3.0
  const LIFT = 0.035;                // clear of the fleece
  const THICK = 0.05;

  const raycaster = new THREE.Raycaster();
  const origin = new THREE.Vector3();
  const target = new THREE.Vector3();
  const dir = new THREE.Vector3();

  const outer = [];
  const inner = [];
  const uvs = [];
  for (let r = 0; r <= ROWS; r++) {
    const t = r / ROWS;
    const z = THREE.MathUtils.lerp(Z0, Z1, t);
    for (let c = 0; c <= COLS; c++) {
      const s = c / COLS;
      const a = (s * 2 - 1) * SPREAD;
      target.set(0, AXIS_Y, z);
      origin.set(Math.sin(a) * 4, AXIS_Y + Math.cos(a) * 4, z);
      dir.copy(target).sub(origin).normalize();
      raycaster.set(origin, dir);
      const hit = raycaster.intersectObjects(meshes, false)[0];
      // No hit can only happen off the end of the barrel; fall back to the nominal
      // cylinder rather than dropping a vertex and tearing the sheet open.
      const p = hit ? hit.point.clone() : new THREE.Vector3(Math.sin(a) * 0.56, AXIS_Y + Math.cos(a) * 0.66, z);
      const n = hit ? hit.face.normal.clone().normalize() : p.clone().sub(target).normalize();
      if (n.dot(dir) > 0) n.negate();
      outer.push(p.clone().addScaledVector(n, LIFT + THICK));
      inner.push(p.clone().addScaledVector(n, LIFT));
      uvs.push(s * 3, t * 2.2);
    }
  }

  const positions = [];
  const normals = [];
  const uv = [];
  const index = [];
  const at = (r, c) => r * (COLS + 1) + c;
  const push = (v, u0, v0) => { positions.push(v.x, v.y, v.z); uv.push(u0, v0); normals.push(0, 0, 0); return positions.length / 3 - 1; };

  const outIdx = outer.map((v, i) => push(v, uvs[i * 2], uvs[i * 2 + 1]));
  const inIdx = inner.map((v, i) => push(v, uvs[i * 2], uvs[i * 2 + 1]));
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const a = at(r, c), b = at(r + 1, c), d = at(r, c + 1), e = at(r + 1, c + 1);
      index.push(outIdx[a], outIdx[b], outIdx[d], outIdx[d], outIdx[b], outIdx[e]);
      index.push(inIdx[a], inIdx[d], inIdx[b], inIdx[b], inIdx[d], inIdx[e]); // reversed
    }
  }
  // The rim: four strips joining outer to inner, so the cloth is closed.
  const seam = (a, b) => { index.push(outIdx[a], inIdx[a], outIdx[b], outIdx[b], inIdx[a], inIdx[b]); };
  const seamR = (a, b) => { index.push(outIdx[a], outIdx[b], inIdx[a], inIdx[a], outIdx[b], inIdx[b]); };
  for (let c = 0; c < COLS; c++) { seamR(at(0, c), at(0, c + 1)); seam(at(ROWS, c), at(ROWS, c + 1)); }
  for (let r = 0; r < ROWS; r++) { seam(at(r, 0), at(r + 1, 0)); seamR(at(r, COLS), at(r + 1, COLS)); }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();

  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ map: texture, roughness: 0.92, metalness: 0 }));
}

// An Andean weaving: warp-faced stripes in the natural dye colours, with the stepped
// diamond and zig-zag motifs that actually appear on Cusco-region cloth. Drawn rather
// than shipped as an image so the world file stays a few kilobytes.
function llamaBlanketTexture(seed) {
  const rng = seededRandom(seed);
  const bands = ['#a8232b', '#d9762b', '#e8c547', '#186f6b', '#2b3a6b', '#f2ece0', '#7b2d63'];
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#7a1f24';
    ctx.fillRect(0, 0, w, h);
    let y = 0;
    while (y < h) {
      const bh = 6 + Math.floor(rng() * 22);
      const c = bands[Math.floor(rng() * bands.length)];
      ctx.fillStyle = c;
      ctx.fillRect(0, y, w, bh);
      // A motif band, but only on the wider stripes -- a pattern in a 6px band is noise.
      if (bh > 16) {
        ctx.fillStyle = rng() > 0.5 ? '#f2ece0' : '#2b3a6b';
        const step = 22;
        for (let x = 0; x < w; x += step) {
          const cy = y + bh / 2;
          ctx.beginPath();
          ctx.moveTo(x + step / 2, cy - bh * 0.3);
          ctx.lineTo(x + step * 0.85, cy);
          ctx.lineTo(x + step / 2, cy + bh * 0.3);
          ctx.lineTo(x + step * 0.15, cy);
          ctx.closePath();
          ctx.fill();
        }
      }
      y += bh;
    }
    // Fine warp lines, which is what makes it read as woven rather than printed.
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#000';
    for (let x = 0; x < w; x += 3) ctx.fillRect(x, 0, 1, h);
    ctx.globalAlpha = 1;
  });
}

// A llama, from the model shipped in public/llama/. `fleece` recolours the wool (see
// llamaFleeceTones); `blanket` puts a woven pack cloth on its back, which is both the
// iconic Andean image and the point the world's own placard makes about why there are no
// carts on any Inca road.
export async function loadLlamaModel({ fleece = 0xd8cbb0, blanket = false, seed = 7 } = {}) {
  if (!llamaBytesPromise) {
    llamaBytesPromise = fetchAsFile(LLAMA_URL, 'llama.glb', 'model/gltf-binary')
      .then((file) => file.arrayBuffer());
  }
  let bytes;
  try {
    bytes = await llamaBytesPromise;
  } catch (err) {
    // Never let one failed fetch poison every later llama in the world.
    llamaBytesPromise = null;
    throw err;
  }

  const file = new File([bytes.slice(0)], 'llama.glb', { type: 'model/gltf-binary' });
  const object3D = await loadModelFile({ file, ext: 'glb' });

  const tones = llamaFleeceTones(fleece);
  // ONE relief tile shared by the wool materials of THIS llama only. Fresh per call, for
  // the same disposal reason as everything else here -- and small, because it is.
  const fleeceRelief = relief('weave', { seed, repeat: 6 });
  const meshes = [];
  object3D.traverse((node) => {
    if (!node.isMesh) return;
    meshes.push(node);
    const name = node.material?.name || '';
    const m = node.material;
    // The baked file already carries metalness 0 -- there is no environment map anywhere
    // in this app, so any metalness on wool renders it muddy. Asserted rather than assumed.
    m.metalness = 0;
    if (name === 'Main') { m.color.copy(tones.base); Object.assign(m, fleeceRelief); }
    else if (name === 'Main_Light') { m.color.copy(tones.light); Object.assign(m, fleeceRelief); }
    else if (name === 'Main_Dark') { m.color.copy(tones.dark); Object.assign(m, fleeceRelief); }
  });

  if (blanket) object3D.add(llamaBlanket(meshes, llamaBlanketTexture(seed)));

  tagShadows(object3D);
  scaleToHeight(object3D, MODEL_TARGET_HEIGHT);
  return object3D;
}
