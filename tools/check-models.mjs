// Regression check for the Model Database (src/models/).
//
//   node tools/check-models.mjs            every model
//   node tools/check-models.mjs violin     one or more, by id
//
// Builds every model in node and holds it to the catalogue's rules. It sees what a count can
// see, and that is only half the job: an unjoined limb produces no open edge at all, so looking
// at each model through tools/model-pictures.mjs --shot is still required.
//
//   THE CATALOGUE  every id unique, every field present, every starter program real.
//   BUDGET         triangles, meshes, transparent meshes, point lights. A student may place
//                  fifteen of these in a world that is already full.
//   OUTSIDE OUT    a closed mesh's signed volume must be positive. Inside-out geometry under a
//                  FrontSide material does not vanish, it renders as the far inner wall lit by
//                  inverted normals, which reads as a torn shell. Fantastic Voyage's lungs do
//                  exactly this, which is why they are not reused here.
//   OPEN EDGES     counted by welded position over two cell sizes, the check-andes method. A
//                  count above the recorded baseline is a new hole.
//   THE HOUSE RULES  origin at the base centre, root scale of 1 (a record's transform replaces
//                  it), rebuilt identically every time, and nothing shared between two builds,
//                  because PlacedRegistry disposes a removed object's materials outright.
const canvasContext = new Proxy({}, {
  get(target, key) {
    if (key === 'measureText') return (text) => ({ width: String(text).length * 9 });
    if (key === 'createLinearGradient' || key === 'createRadialGradient' || key === 'createConicGradient') return () => ({ addColorStop() {} });
    if (key === 'createPattern') return () => ({});
    if (key === 'createImageData') return (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
    if (key === 'getImageData') return (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
    if (key in target) return target[key];
    return () => {};
  },
  set(target, key, value) { target[key] = value; return true; },
});
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => canvasContext, addEventListener() {}, setAttribute() {}, appendChild() {} }),
  createElementNS: () => ({ style: {}, addEventListener() {}, removeEventListener() {}, setAttribute() {} }),
  body: { appendChild() {} },
};
globalThis.HTMLCanvasElement = class {};
globalThis.window = globalThis;
globalThis.Image = class { addEventListener() {} set src(value) {} };
try { globalThis.localStorage = { getItem: () => null, setItem() {} }; } catch { /* node 22 has its own */ }

const { MODELS, MODEL_CATEGORIES, GRADE_BANDS, searchModels } = await import('../src/models/catalog.js');
const { STARTER_PROGRAMS } = await import('../src/models/programs.js');
const { buildCatalogModel } = await import('../src/models/index.js');

const DEFAULT_BUDGET = { triangles: 60000, meshes: 6, transparent: 1 };
// Models reused from a world, at what they measured when they were adopted. Each is over the
// default for a reason that belongs to the world it came from, and a rise is still a failure.
const BUDGET = {
  colosseum: { triangles: 65000 },
  'taj-mahal': { meshes: 9 },
  '1948-taxi': { meshes: 9, transparent: 3 },
};
// Recorded when each model was adopted, after looking at it from every side: tube rims buried in
// sockets, wires with no ends in view, label planes, flat-shaded block faces. They were judged by
// eye rather than traced edge by edge, so this catches a NEW hole and does not certify an old one.
// Raise a number only after looking at the model and confirming the rise is not a visible gap.
const OPEN_EDGES = {
  'human-heart': 0,
  'human-brain': 0,
  'human-lungs': 0,
  'animal-cell': 218,
  'dna-helix': 48,
  'human-skeleton': 0,
  'tyrannosaurus-rex': 1624,
  'triceratops': 1332,
  'octopus': 1373,
  'reef-shark': 0,
  'monarch-butterfly': 298,
  'sunflower': 148,
  'honey-bee': 0,
  'leopard-frog': 0,
  'cutaway-volcano': 0,
  'earth-layers': 622,
  'solar-system-orrery': 598,
  'lunar-module': 488,
  'mars-rover': 844,
  'saturn-v': 2632,
  'amethyst-geode': 288,
  'carbon-atom': 96,
  'water-molecule': 16,
  'salt-crystal': 1804,
  'newtons-cradle': 346,
  'compound-microscope': 304,
  'gear-train': 156,
  'classroom-robot': 0,
  'da-vinci-ornithopter': 724,
  '1948-taxi': 8,
  'steam-locomotive': 1368,
  'wright-flyer': 546,
  'printing-press': 290,
  'great-sphinx': 634,
  'pyramid-of-giza': 30,
  'colosseum': 5040,
  'statue-of-liberty': 848,
  'taj-mahal': 636,
  'parthenon': 11192,
  'medieval-castle': 426,
  'armillary-sphere': 256,
  'rosetta-stone': 680,
  'viking-longship': 2601,
  'greek-amphora': 0,
  'abacus': 0,
  'covered-wagon': 194,
  'grand-piano': 37,
  'violin': 41,
  'djembe': 10,
  'artists-easel': 92,
  'human-eye': 2542,
  'human-ear': 2939,
  'tooth-section': 4999,
  'skin-section': 1263,
  'digestive-system': 20,
  'plant-cell': 210,
  'flower-anatomy': 0,
  'tree-trunk-section': 824,
  'woolly-mammoth': 0,
  'stegosaurus': 0,
  'bald-eagle': 0,
  'emperor-penguin': 0,
  'saturn-planet': 144,
  'hubble-telescope': 552,
  'voyager-probe': 96,
  'rock-strata-block': 1044,
  'plate-boundary-block': 1241,
  'water-cycle-diorama': 1534,
  'lab-glassware': 1077,
  'simple-circuit': 44,
  'bar-magnet-field': 796,
  'glass-prism': 0,
  'pulley-system': 124,
  'platonic-solids': 24,
  'pythagorean-theorem': 11,
  'nautilus-shell': 5184,
  'mobius-strip': 4,
  'model-t-ford': 298,
  'penny-farthing': 0,
  'montgolfier-balloon': 0,
  'edison-phonograph': 96,
  'watt-steam-engine': 0,
  'eiffel-tower': 38280,
  'great-wall': 5166,
  'leaning-tower-of-pisa': 19042,
  'stonehenge': 1610,
  'el-castillo': 6024,
  'trebuchet': 0,
  'liberty-bell': 0,
  'knight-armor': 356,
  'samurai-armor': 482,
  'cuneiform-tablet': 0,
  'inca-quipu': 0,
  'acoustic-guitar': 286,
  'concert-harp': 0,
  'trumpet': 16,
  'sitar': 0,
  'theatre-masks': 1328,
  'globe-theatre': 28,
  'illuminated-manuscript': 566,
  'neuron': 220,
  'human-kidney': 2165,
  'arm-muscles': 0,
  'venus-flytrap': 0,
  'giant-panda': 0,
  'blue-whale': 0,
  'ant-colony': 2799,
  'space-station': 544,
  'sputnik-1': 0,
  'hurricane-model': 1243,
  'periodic-table': 0,
  'galileo-telescope': 0,
  'sierpinski-pyramid': 4,
  'galton-board': 20,
  'fraction-wall': 388,
  'typewriter': 12,
  'wind-turbine': 0,
  'water-mill': 26,
  'golden-gate-bridge': 16823,
  'petra-treasury': 367,
  'sydney-opera-house': 3601,
  'roman-chariot': 0,
  'ming-vase': 0,
  'potters-wheel': 428,
  'drum-kit': 592,
};
// Reused models keep what their own world established; these rules bind what is built for here.
const REUSED_SKIP = new Set(['outside', 'origin']);

const wanted = process.argv.slice(2).filter((a) => !a.startsWith('--'));
let failures = 0;
const fail = (id, message) => { failures += 1; console.log(`FAIL ${id}: ${message}`); };

// --- the table -------------------------------------------------------------------------
const seen = new Set();
const categoryKeys = new Set(MODEL_CATEGORIES.map((c) => c.key));
for (const m of MODELS) {
  if (seen.has(m.id)) fail(m.id, 'duplicate id');
  seen.add(m.id);
  if (!/^[a-z0-9-]+$/.test(m.id)) fail(m.id, 'an id must be lowercase-with-dashes');
  if (!categoryKeys.has(m.category)) fail(m.id, `unknown category ${m.category}`);
  if (!!m.prop === !!m.builder) fail(m.id, 'needs exactly one of prop or builder');
  for (const field of ['title', 'blurb', 'realSize', 'shownAt', 'tryThis']) if (!m[field]) fail(m.id, `no ${field}`);
  if (!(m.facts?.length >= 2)) fail(m.id, 'needs at least two facts');
  if (!(m.aliases?.length >= 3)) fail(m.id, 'needs at least three search aliases');
  if (!(m.subjects?.length >= 1)) fail(m.id, 'needs a subject');
  if (!m.grades?.length || m.grades.some((g) => !GRADE_BANDS.includes(g))) fail(m.id, 'bad grades');
  if (m.program && !STARTER_PROGRAMS[m.program]) fail(m.id, `no starter program ${m.program}`);
  if (!(m.scale > 0)) fail(m.id, 'needs a positive scale');
}
for (const category of MODEL_CATEGORIES) {
  if (!MODELS.some((m) => m.category === category.key)) fail(category.key, 'an empty category');
}
for (const [query, id] of [['mitochondria', 'animal-cell'], ['t rex', 'tyrannosaurus-rex'], ['rex', 'tyrannosaurus-rex'], ['oregon trail', 'covered-wagon'], ['h2o', 'water-molecule'], ['hieroglyphs', 'rosetta-stone'], ['cochlea', 'human-ear'], ['ice age', 'woolly-mammoth'], ['euler', 'platonic-solids'], ['khipu', 'inca-quipu'], ['shakespeare', 'globe-theatre']]) {
  if (searchModels(query)[0]?.id !== id) fail(`search "${query}"`, `first result is ${searchModels(query)[0]?.id}`);
}
if (searchModels('xyzzy').length) fail('search "xyzzy"', 'should find nothing');

// --- the geometry ----------------------------------------------------------------------
function openEdges(geometry, cell) {
  const pos = geometry.attributes.position;
  const idx = geometry.index;
  const key = (i) => `${Math.round(pos.getX(i) / cell)},${Math.round(pos.getY(i) / cell)},${Math.round(pos.getZ(i) / cell)}`;
  const seenEdges = new Map();
  const n = idx ? idx.count : pos.count;
  const at = (k) => (idx ? idx.getX(k) : k);
  for (let t = 0; t < n; t += 3) {
    const a = key(at(t));
    const b = key(at(t + 1));
    const c = key(at(t + 2));
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      if (p === q) continue;
      const e = p < q ? `${p}|${q}` : `${q}|${p}`;
      seenEdges.set(e, (seenEdges.get(e) || 0) + 1);
    }
  }
  let open = 0;
  for (const v of seenEdges.values()) if (v === 1) open += 1;
  return open;
}

function signedVolume(geometry) {
  const p = geometry.attributes.position;
  const idx = geometry.index;
  const n = idx ? idx.count : p.count;
  let volume = 0;
  for (let i = 0; i < n; i += 3) {
    const a = idx ? idx.getX(i) : i;
    const b = idx ? idx.getX(i + 1) : i + 1;
    const c = idx ? idx.getX(i + 2) : i + 2;
    const ax = p.getX(a), ay = p.getY(a), az = p.getZ(a);
    const bx = p.getX(b), by = p.getY(b), bz = p.getZ(b);
    const cx = p.getX(c), cy = p.getY(c), cz = p.getZ(c);
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return volume;
}

function measure(object3D) {
  object3D.updateMatrixWorld(true);
  const out = { triangles: 0, meshes: 0, transparent: 0, lights: 0, open: 0, bad: [], min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9], hash: 0, materials: [], textures: [], geometries: [] };
  object3D.traverse((node) => {
    if (node.isLight) out.lights += 1;
    if (!node.isMesh) return;
    out.meshes += 1;
    const g = node.geometry;
    const p = g.attributes.position;
    out.triangles += (g.index ? g.index.count : p.count) / 3;
    out.geometries.push(g);
    out.open += Math.min(openEdges(g, 1 / 512), openEdges(g, 1 / 300));
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    if (materials.some((m) => m.transparent)) out.transparent += 1;
    for (const m of materials) {
      out.materials.push(m);
      if (m.isShaderMaterial || m.onBeforeCompile?.toString().includes('customProgramCacheKey')) out.bad.push('custom shader');
      for (const value of Object.values(m)) if (value?.isTexture) out.textures.push(value);
    }
    if (!materials.some((m) => m.side === 2) && signedVolume(g) * node.matrixWorld.determinant() < -1e-3) out.bad.push('inside out');
    g.computeBoundingBox();
    const b = g.boundingBox.clone().applyMatrix4(node.matrixWorld);
    for (const [i, axis] of ['x', 'y', 'z'].entries()) {
      out.min[i] = Math.min(out.min[i], b.min[axis]);
      out.max[i] = Math.max(out.max[i], b.max[axis]);
    }
    for (let i = 0; i < p.count; i += Math.max(1, Math.floor(p.count / 400))) {
      out.hash = (out.hash * 31 + Math.round(p.getX(i) * 1000) + Math.round(p.getY(i) * 7000) + Math.round(p.getZ(i) * 13000)) % 2147483647;
    }
  });
  return out;
}

const rows = [];
let sum = 0;
for (const entry of MODELS) {
  if (wanted.length && !wanted.includes(entry.id)) continue;
  let a;
  let b;
  try {
    a = await buildCatalogModel(entry.id);
    b = await buildCatalogModel(entry.id);
  } catch (err) {
    fail(entry.id, `does not build: ${err.message}`);
    continue;
  }
  const m = measure(a);
  const n = measure(b);
  const budget = { ...DEFAULT_BUDGET, ...BUDGET[entry.id] };
  if (m.triangles > budget.triangles) fail(entry.id, `${Math.round(m.triangles)} triangles over the ${budget.triangles} budget`);
  if (m.meshes > budget.meshes) fail(entry.id, `${m.meshes} meshes over the ${budget.meshes} budget`);
  if (m.transparent > budget.transparent) fail(entry.id, `${m.transparent} transparent meshes over the ${budget.transparent} budget`);
  if (m.lights) fail(entry.id, `${m.lights} point lights`);
  const reused = !!entry.prop;
  if (m.bad.includes('custom shader')) fail(entry.id, 'a custom shader cannot cross to HiFi');
  if (!reused && m.bad.includes('inside out')) fail(entry.id, 'a mesh is inside out (negative signed volume)');
  if (a.scale.x !== 1 || a.scale.y !== 1 || a.scale.z !== 1) fail(entry.id, 'the root must keep scale 1: a record’s transform replaces it');
  const w = m.max[0] - m.min[0];
  const d = m.max[2] - m.min[2];
  const h = m.max[1] - m.min[1];
  if (!reused) {
    if (Math.abs((m.max[0] + m.min[0]) / 2) > w * 0.2 + 0.05 || Math.abs((m.max[2] + m.min[2]) / 2) > d * 0.2 + 0.05) fail(entry.id, 'origin is not near the base centre');
    if (m.min[1] > 0.2 || m.min[1] < -Math.max(0.5, h * 0.05)) fail(entry.id, `base is at y=${m.min[1].toFixed(2)}, not on the origin`);
  }
  if (m.hash !== n.hash) fail(entry.id, 'two builds differ: use seededRandom, never Math.random');
  const shared = (list, other) => list.filter((x) => other.includes(x)).length;
  if (shared(m.geometries, n.geometries)) fail(entry.id, 'two builds share a geometry');
  if (shared(m.materials, n.materials)) fail(entry.id, 'two builds share a material');
  if (shared(m.textures, n.textures)) fail(entry.id, 'two builds share a texture');
  const baseline = OPEN_EDGES[entry.id];
  if (baseline !== undefined && m.open > baseline) fail(entry.id, `${m.open} open edges, baseline ${baseline}`);
  sum += m.triangles;
  rows.push(`${entry.id.padEnd(24)} ${String(Math.round(m.triangles / 100) / 10).padStart(6)}k ${String(m.meshes).padStart(3)}m ${String(m.transparent).padStart(2)}t ${String(m.open).padStart(5)} open  ${w.toFixed(1)} x ${h.toFixed(1)} x ${d.toFixed(1)} ft${reused ? '  (reused)' : ''}`);
}
console.log(rows.join('\n'));
if (!wanted.length) console.log(`\n${MODELS.length} models, ${Math.round(sum / 1000)}k triangles if one of each were placed.`);
console.log(failures ? `\n${failures} failure(s).` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
