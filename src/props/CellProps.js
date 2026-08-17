import * as THREE from 'three';
import {
  standard,
  mesh,
  group,
  mergedMesh,
  canvasTexture,
  signPanel,
  taperedTube,
  roughenSphere,
  seededRandom,
  randomIn,
  relief,
} from '../PropKit.js';

// "Inside an Animal Cell" -- the student is standing in the cytosol at roughly six
// million times life size, and the organelles around them are buildings.
//
// THE SCALE IS CONSISTENT ACROSS THE FIVE MAIN ORGANELLES, and that is the teaching point
// rather than an accident of composition. A real animal cell is about 20 micrometres
// across; blown up until it fills this world, its nucleus lands at about 50ft and a
// mitochondrion at 30ft. Every placard states the real micrometre figure, so the
// enlargement teaches instead of misleading, exactly as Fantastic Voyage's organs do.
//
// THE ONE EXCEPTION IS THE FREE RIBOSOME, and it is worth knowing why rather than being
// quietly fixed. At this magnification a 25-nanometre ribosome is about three inches --
// too small to see across a room and too small to click, so a walk-up prop at true scale
// would be an object a student can neither find nor program. So `freeRibosome` is drawn
// several times oversize and SAYS SO on its own tag, the same bargain the Colosseum makes
// at 1/3 and Egypt at 1/5.
//
// The ribosomes studded over the rough ER are NOT the exception: those are at true scale,
// which is exactly why they are the size of grapes on a 30ft sheet. That contrast between
// the two is worth pointing at rather than hiding.
//
// WHY THE COLOURS ARE TEXTBOOK COLOURS. A real cell is nearly transparent and almost
// colourless; every organelle here is instead the colour it is drawn in a biology text --
// violet nucleus, red-orange mitochondrion, teal Golgi, blue ribosomes. That is not
// decoration. A student is being asked to recognise these shapes again on a page and in a
// microscope-slide photograph, and the colour is half of what they actually memorise. The
// `cell` theme is a desaturated blue-grey for the same reason: the cytosol is the one
// surface in this world that is not trying to be identified, so it loses.
//
// House rules from PropKit.js apply: feet at scale 1, origin at base centre, fresh
// materials per call, seededRandom rather than Math.random.

// Organelle palette. Saturated on purpose -- see above, and note that everything
// translucent here loses most of its apparent colour to the alpha, so the source colours
// are pitched brighter than they should look.
const CYTOSOL_RIM = 0x7fa8c4;
const NUCLEUS_ENVELOPE = 0x8f6bb5;
const NUCLEUS_INNER = 0x6a4a8c;
const CHROMATIN = 0xd9a3e8;
const NUCLEOLUS = 0x4a2d66;
const PORE_RING = 0xf0d68c;
const MITO_OUTER = 0xd4633c;
const MITO_INNER = 0xf2a05c;
const MITO_MATRIX = 0x8c3a20;
const ER_MEMBRANE = 0xc4a05c;
const RIBOSOME = 0x3f6fb5;
const GOLGI_SAC = 0x3f9c9c;
const GOLGI_EDGE = 0x2b6e70;
const VESICLE = 0x7fd4c4;
const LYSOSOME = 0xb54a7c;
const MEMBRANE_HEAD = 0xe8c25c;
const MEMBRANE_TAIL = 0xc4923c;
const PROTEIN_BLUE = 0x4a7fc4;
const MICROTUBULE = 0xa8b4c4;
const CENTRIOLE = 0x8fa0b4;

const LABEL_INK = '#eef4fa';
const LABEL_BG = '#16202c';

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

function tube(points, radii, color, options) {
  return { geometry: taperedTube(points, radii, options), color };
}

// `detail` floors at 3 height segments rather than the instinctive 5, which is the lesson
// Under the Sea paid ~60,000 triangles for: almost everything in this file is a SMALL
// sphere asked for at low detail -- a ribosome, a pore ring, a vesicle, an enzyme granule
// -- and a floor of 5 quietly makes each one a fifty-triangle ball a few inches across.
// The opposite bound matters too: at 4 width segments a sphere is square in cross-section,
// so nothing goes below 6.
function ball(radius, detail = 10) {
  return new THREE.SphereGeometry(radius, Math.max(6, detail), Math.max(3, detail >> 1));
}

// A translucent organelle shell.
//
// CLOSED shells default to FrontSide, which is the lungs' lesson repeated: with DoubleSide
// every shell contributes TWO transparent layers, so where three organelles overlap the
// viewer looks through six surfaces and the overlaps darken into what read as hard cracks
// between them. Culling back faces halves the stack and the contents are still perfectly
// visible through the front shell, which was the only thing DoubleSide bought.
//
// A CUTAWAY shell must pass `cutaway: true`, and that is not a preference -- it is the
// difference between the model working and not. Looking into an opening means looking at
// the INSIDE of the far wall, and the inside of a sphere is its back faces: under FrontSide
// they are culled, the entire interior vanishes, and what is left is the two rim arcs of
// the cut. The nucleus rendered exactly like that on the first pass -- a pair of purple
// claws with a ball floating between them, nothing like a sphere with a section removed.
// The stacking cost is real but it is paid on two organelles, not on every one.
//
// castShadow is left off by the caller for the same reason the museum's skylight is:
// three.js has no light transmission, so a translucent shell that casts a shadow puts a
// solid black disc on the floor under a thing you can see through.
function shellMaterial(color, opacity, { roughness = 0.45, emissive = null, cutaway = false } = {}) {
  const params = {
    color,
    roughness,
    metalness: 0.05,
    transparent: true,
    opacity,
    side: cutaway ? THREE.DoubleSide : THREE.FrontSide,
    depthWrite: false,
  };
  if (emissive) {
    params.emissive = emissive;
    params.emissiveIntensity = 0.35;
  }
  return standard(params);
}

// A membrane's own texture: fine mottling, because a lipid bilayer under an electron
// micrograph is grainy rather than smooth. bumpMap only -- these shells are translucent
// and a colour map multiplied into an already-dim alpha comes out as dirt.
function membraneRelief(seed, repeat = 4) {
  return relief('weave', { seed, repeat, strength: 0.5 });
}

// ---------------------------------------------------------------------------
// A floating name tag
// ---------------------------------------------------------------------------

// Organelles are not standing on plinths in here -- they are suspended in fluid, which is
// what a cell actually is -- so the label floats beside its organelle rather than sitting
// under it on a drum.
//
// It is DOUBLE-SIDED with the text drawn on both faces, unlike the museum's plinth plates.
// Those are approached from a known direction across a gallery floor; these are hanging in
// open cytosol with the student free to drift round the far side of them, and a name that
// is blank from half the angles you can read it from is worse than no name.
export function organelleTag({
  name = 'ORGANELLE',
  realSize = '',
  job = '',
  width = 7,
  accent = '#7fd4c4',
} = {}) {
  const g = group();
  const height = width * 0.42;

  const texture = canvasTexture(896, 376, (ctx, w, h) => {
    ctx.fillStyle = LABEL_BG;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 8;
    ctx.strokeRect(14, 14, w - 28, h - 28);

    // Every line is SHRUNK TO FIT. None of these three is wrapped -- a tag is read at a
    // glance from across a room and a wrapped paragraph on one defeats the point -- so
    // without a fit, a long name simply runs off both edges. "MITOCHONDRION" and
    // "FREE RIBOSOMES" both did exactly that at the fixed 82px this started at, and the
    // caller has no way to predict the limit.
    const fit = (text, startPx, weight, maxWidth) => {
      let size = startPx;
      ctx.font = `${weight} ${size}px "Helvetica Neue", Arial, sans-serif`;
      while (size > 14 && ctx.measureText(text).width > maxWidth) {
        size -= 2;
        ctx.font = `${weight} ${size}px "Helvetica Neue", Arial, sans-serif`;
      }
      return size;
    };

    const inner = w - 76;
    ctx.textAlign = 'center';
    ctx.fillStyle = LABEL_INK;
    fit(String(name).toUpperCase(), 82, 'bold', inner);
    ctx.fillText(String(name).toUpperCase(), w / 2, 118);

    if (realSize) {
      ctx.fillStyle = accent;
      fit(realSize, 44, 'bold', inner);
      ctx.fillText(realSize, w / 2, 186);
    }
    if (job) {
      ctx.fillStyle = '#c3cede';
      fit(job, 40, '', inner);
      ctx.fillText(job, w / 2, realSize ? 262 : 226);
    }
  });

  const panel = signPanel(width, height, texture, { emissive: 0x2a3f55, emissiveIntensity: 0.5 });
  panel.material.side = THREE.DoubleSide;
  panel.position.y = height / 2;
  g.add(panel);

  // The back face of a DoubleSide panel shows the texture mirrored, so a second panel is
  // turned to face the other way rather than relying on the one sheet.
  const back = signPanel(width, height, texture, { emissive: 0x2a3f55, emissiveIntensity: 0.5 });
  back.material.side = THREE.DoubleSide;
  back.position.y = height / 2;
  back.position.z = -0.05;
  back.rotation.y = Math.PI;
  g.add(back);

  return g;
}

// ---------------------------------------------------------------------------
// 1. The nucleus -- the big one
// ---------------------------------------------------------------------------

// A cutaway sphere: outer envelope open on one side so a student can walk up and see the
// chromatin and the nucleolus inside.
//
// THE CUTAWAY IS A SPHERE WITH A REDUCED phiLength, NOT a whole sphere with a dark hole
// stuck on it. That is the reef cave's lesson -- build the void first. A closed shell with
// a black patch reads as a stain; an actually-open shell reads as a section through
// something, and the cut edge is what says "this has been opened".
//
// The inner envelope is a second, slightly smaller shell: a nuclear envelope is a DOUBLE
// membrane, and that is one of the two things about it worth knowing. The other is the
// pores, which is why they are large enough to see from outside.
export function cellNucleus({ radius = 24, pores = 26, seed = 3 } = {}) {
  const g = group();
  const rng = seededRandom(seed);

  // The opening faces +Z, which is a prop's own forward -- so the layout turns the whole
  // organelle with the usual facing() and the mouth lands on the walk-up.
  //
  // Getting that right is fiddly and was wrong first time round. SphereGeometry covers
  // phi in [phiStart, phiStart + phiLength]; the MISSING wedge is everything after it, so
  // the wedge is centred on `phiStart + phiLength + OPEN/2`. Starting at
  // `PI/2 + OPEN/2` puts that centre at exactly PI/2, and three.js's sphere maps phi=PI/2
  // to +Z. The instinctive `-PI/2 - OPEN/2` puts the mouth on +X instead: the nucleus then
  // presents an unbroken shell to anyone approaching it, which is precisely the one thing
  // a cutaway must not do.
  const OPEN = Math.PI * 0.52;          // how much of the sphere is cut away
  const start = Math.PI / 2 + OPEN / 2;
  const span = Math.PI * 2 - OPEN;

  const outerGeo = new THREE.SphereGeometry(radius, 44, 28, start, span);
  const outer = mesh(outerGeo, shellMaterial(NUCLEUS_ENVELOPE, 0.34, { cutaway: true, ...membraneRelief(seed) }), 0, radius, 0);
  outer.castShadow = false;
  outer.receiveShadow = false;
  g.add(outer);

  const innerGeo = new THREE.SphereGeometry(radius * 0.94, 40, 26, start, span);
  const inner = mesh(innerGeo, shellMaterial(NUCLEUS_INNER, 0.4, { cutaway: true, ...membraneRelief(seed + 1) }), 0, radius, 0);
  inner.castShadow = false;
  inner.receiveShadow = false;
  g.add(inner);

  // --- Nuclear pores ------------------------------------------------------
  // Rings sunk into the envelope, each an open torus lying flat on the surface. They are
  // placed by a golden-angle spiral over the sphere rather than at random: pores are
  // genuinely evenly spread, and random placement on a sphere clumps visibly.
  const poreParts = [];
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < pores; i++) {
    const t = (i + 0.5) / pores;
    const phi = Math.acos(1 - 2 * t);
    const theta = GOLDEN * i;
    const dir = new THREE.Vector3(
      Math.sin(phi) * Math.cos(theta),
      Math.cos(phi),
      Math.sin(phi) * Math.sin(theta),
    );
    // Skip anything that would land in the cut-away mouth, where there is no envelope to
    // put a pore in -- a ring floating in the opening is unmistakably a mistake. Measured
    // against +Z because that is where the mouth is (see the phiStart note above); tested
    // against the wrong axis this silently punches a bald patch in the wrong side.
    const angleFromOpening = dir.angleTo(new THREE.Vector3(0, 0, 1));
    if (angleFromOpening < OPEN * 0.62) continue;

    const ringR = radius * randomIn(rng, 0.055, 0.075);
    const geometry = new THREE.TorusGeometry(ringR, ringR * 0.36, 6, 14);
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(quat));
    const at = dir.clone().multiplyScalar(radius * 0.985);
    geometry.translate(at.x, at.y + radius, at.z);
    poreParts.push({ geometry, color: PORE_RING });
  }
  const poreMesh = mergedMesh(poreParts, { color: 0xffffff, roughness: 0.5, metalness: 0.1 });
  poreMesh.castShadow = false;
  g.add(poreMesh);

  // --- Nucleolus ----------------------------------------------------------
  // A dense opaque blob, off centre. Opaque on purpose: it is the one thing inside the
  // nucleus that is denser than everything around it, and making it see-through like the
  // shells would lose exactly the property that identifies it.
  const nucleolusGeo = ball(radius * 0.3, 20);
  roughenSphere(nucleolusGeo, { amount: 0.14, phase: 1.7 });
  const nucleolus = mesh(
    nucleolusGeo,
    standard({ color: NUCLEOLUS, roughness: 0.62, ...relief('stone', { seed: seed + 4, repeat: 2, strength: 0.7 }) }),
    radius * 0.12,
    radius * 0.92,
    radius * 0.1,
  );
  g.add(nucleolus);

  // --- Chromatin ----------------------------------------------------------
  // Loose threads filling the space, NOT tidy X-shaped chromosomes. That distinction is
  // the single most-missed fact about a nucleus: condensed chromosomes only exist during
  // division, and a resting nucleus holds a tangle. Drawing the X shape here would teach
  // the wrong thing in the one place a student is most likely to remember it.
  const threads = [];
  for (let i = 0; i < 13; i++) {
    const pts = [];
    let p = new THREE.Vector3(
      randomIn(rng, -0.5, 0.5),
      randomIn(rng, -0.5, 0.5),
      randomIn(rng, -0.5, 0.5),
    ).normalize().multiplyScalar(radius * randomIn(rng, 0.15, 0.5));
    for (let k = 0; k < 6; k++) {
      pts.push([p.x, p.y + radius, p.z]);
      p = p.clone().add(new THREE.Vector3(
        randomIn(rng, -1, 1),
        randomIn(rng, -1, 1),
        randomIn(rng, -1, 1),
      ).multiplyScalar(radius * 0.2));
      // Keep the tangle inside the envelope: a thread that pokes out through a nuclear
      // membrane is a different cell-biology event entirely.
      if (p.length() > radius * 0.66) p.setLength(radius * 0.6);
    }
    const r = radius * randomIn(rng, 0.016, 0.028);
    threads.push(tube(pts, pts.map(() => r), CHROMATIN, { tubularSegments: 22, radialSegments: 7 }));
  }
  const chromatin = mergedMesh(threads, { color: 0xffffff, roughness: 0.55 });
  chromatin.castShadow = false;
  g.add(chromatin);

  return g;
}

// ---------------------------------------------------------------------------
// 2. The mitochondrion -- the one they must recognise
// ---------------------------------------------------------------------------

// Built as a long capsule cut open down its length, because the cristae ARE the organelle
// and a closed mitochondrion is an orange bean that teaches nothing. The outer membrane is
// a shell with a lengthwise slice removed; the inner membrane sits inside it and folds
// back and forth into the matrix.
export function mitochondrion({ length = 30, radius = 7, cristae = 11, seed = 8 } = {}) {
  const g = group();

  // Everything below is authored UPRIGHT -- the long axis along local Y, centred on the
  // origin -- and then the whole assembly is tipped onto its side and lifted so it rests
  // on the ground. Building it lying down directly would mean doing the theta-window
  // arithmetic for the cut in a rotated frame twice over, once for a cylinder (whose
  // theta = 0 is +Z) and once for a sphere (whose phi = PI/2 is +Z), which are different
  // conventions and easy to get silently wrong.
  //
  // The first pass tried to leave it upright and have the LAYOUT lay it down with rotY.
  // That cannot work: rotY spins about the vertical, so a vertical capsule stays vertical
  // however much it is turned, and the organelle rendered as a barrel standing on end. The
  // record only carries rotX and rotY, and the base-on-ground convention would fight rotX
  // anyway, so the tipping belongs here.
  const body = group();

  const OPEN = Math.PI * 0.62;
  const bodyLen = length - radius * 2;

  // The cut faces the model's own +Z, so after the tip below it still faces +Z and the
  // layout's ordinary facing() turns it toward the student.
  //
  // Two different conventions, both giving a wedge centred on +Z:
  //   CylinderGeometry: vertex z = r*cos(theta), so theta = 0 is +Z.
  //   SphereGeometry:   vertex z = r*sin(phi),   so phi = PI/2 is +Z.
  const barStart = OPEN / 2;                        // wedge centred on theta = 0
  const capStart = Math.PI / 2 + OPEN / 2;          // wedge centred on phi = PI/2
  const span = Math.PI * 2 - OPEN;

  const outerMat = shellMaterial(MITO_OUTER, 0.34, { cutaway: true, ...membraneRelief(seed) });
  const barrel = mesh(
    new THREE.CylinderGeometry(radius, radius, bodyLen, 34, 1, true, barStart, span),
    outerMat, 0, 0, 0,
  );
  barrel.castShadow = false;
  barrel.receiveShadow = false;
  body.add(barrel);

  for (const sign of [1, -1]) {
    // A hemisphere carrying the same angular window as the barrel, so the lengthwise
    // opening runs unbroken from one end to the other. A cut cylinder closed with whole
    // end caps reads as a tube with two plugs in it.
    const cap = mesh(
      new THREE.SphereGeometry(radius, 34, 16, capStart, span, 0, Math.PI / 2),
      outerMat, 0, sign * (bodyLen / 2), 0,
    );
    // Flip the lower cap to close downward. Rotating about X by PI leaves the phi window
    // pointing the same way, so the opening stays lined up with the barrel's.
    if (sign < 0) cap.rotation.x = Math.PI;
    cap.castShadow = false;
    cap.receiveShadow = false;
    body.add(cap);
  }

  // --- Inner membrane + cristae -------------------------------------------
  // The folds are flattened discs stacked along the axis, each pushed in from alternating
  // sides so the membrane reads as one sheet folding back and forth rather than as a pile
  // of separate plates. Merged into ONE mesh: eleven folds at three parts each would be
  // thirty-three draw calls for a single organelle.
  const inner = [];
  const innerR = radius * 0.82;
  for (let i = 0; i < cristae; i++) {
    const t = (i + 0.5) / cristae;
    const y = (t - 0.5) * bodyLen * 1.35;
    const side = i % 2 === 0 ? 1 : -1;
    const geometry = new THREE.CylinderGeometry(innerR * 0.86, innerR * 0.86, innerR * 0.3, 20);
    geometry.scale(1, 1, 0.42);
    geometry.rotateX(side * 0.32);
    geometry.translate(side * innerR * 0.2, y, 0);
    inner.push({ geometry, color: MITO_INNER });
  }
  // The matrix: the space the cristae sit in, as one dim capsule so the folds have
  // something to be seen against rather than open sky.
  const matrixGeo = new THREE.CapsuleGeometry(innerR * 0.62, bodyLen * 0.92, 6, 20);
  inner.push({ geometry: matrixGeo, position: [0, 0, 0], color: MITO_MATRIX });

  const innerMesh = mergedMesh(inner, { color: 0xffffff, roughness: 0.5 });
  innerMesh.castShadow = false;
  body.add(innerMesh);

  // Tip onto its side (+Y becomes +X, +Z is unchanged so the cut still faces forward) and
  // lift by the radius so the base of the bean sits on the ground -- the house rule that
  // a builder's origin is its base centre.
  body.rotation.z = -Math.PI / 2;
  body.position.y = radius;
  g.add(body);

  return g;
}

// ---------------------------------------------------------------------------
// 3. Rough endoplasmic reticulum
// ---------------------------------------------------------------------------

// Stacked flattened sheets (cisternae) covered in ribosomes. What makes it ROUGH is the
// ribosomes and nothing else, so they have to be plainly visible as separate beads -- a
// bumpy texture on a smooth sheet reads as dirt, not as ribosomes.
//
// The sheets are wavy rather than flat: real ER is a folded, undulating membrane, and a
// stack of flat plates reads as a bookshelf.
export function roughER({ width = 26, depth = 16, sheets = 5, seed = 12 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const parts = [];
  const ribos = [];

  const SEG_X = 22;
  const SEG_Z = 12;

  for (let s = 0; s < sheets; s++) {
    const y = 2.4 + s * 3.4;
    const w = width * (1 - s * 0.07);
    const d = depth * (1 - s * 0.05);
    const phase = s * 1.3;

    // A subdivided plane displaced by a couple of sine terms, then given thickness by
    // being drawn twice a few inches apart. A real cisterna is a flattened SAC -- two
    // membranes with a lumen between them -- and a single sheet has no edge, so from the
    // side it disappears entirely.
    for (const face of [0.34, -0.34]) {
      const geometry = new THREE.PlaneGeometry(w, d, SEG_X, SEG_Z);
      const pos = geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const px = pos.getX(i);
        const pz = pos.getY(i);   // PlaneGeometry is authored in XY; this becomes depth
        const wave = Math.sin(px * 0.24 + phase) * 0.9 + Math.cos(pz * 0.31 + phase * 1.7) * 0.55;
        pos.setZ(i, wave);
      }
      geometry.computeVertexNormals();
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(0, y + face, 0);
      parts.push({ geometry, color: ER_MEMBRANE });
    }

    // Ribosomes ON the top surface, positioned from the SAME wave function the sheet was
    // displaced by -- read off a flat plane instead and half of them hang in mid-air over
    // the troughs while the other half sink into the crests.
    const count = 40 - s * 4;
    for (let i = 0; i < count; i++) {
      const px = randomIn(rng, -w / 2 + 0.6, w / 2 - 0.6);
      const pz = randomIn(rng, -d / 2 + 0.6, d / 2 - 0.6);
      const wave = Math.sin(px * 0.24 + phase) * 0.9 + Math.cos(pz * 0.31 + phase * 1.7) * 0.55;
      const r = randomIn(rng, 0.26, 0.4);
      // A ribosome is TWO subunits, a big one and a small one, and that is the whole of
      // what a student is asked to know about its shape. One bead would do the job of
      // being visible and none of the job of being a ribosome.
      ribos.push({ geometry: ball(r, 8), position: [px, y + 0.34 + wave + r * 0.6, pz], color: RIBOSOME });
      ribos.push({
        geometry: ball(r * 0.62, 8),
        position: [px + r * 0.5, y + 0.34 + wave + r * 1.5, pz + r * 0.2],
        color: RIBOSOME,
      });
    }
  }

  const sheetMesh = mergedMesh(parts, {
    color: 0xffffff,
    roughness: 0.52,
    side: THREE.DoubleSide,
    ...membraneRelief(seed, 6),
  });
  sheetMesh.castShadow = false;
  g.add(sheetMesh);

  const riboMesh = mergedMesh(ribos, { color: 0xffffff, roughness: 0.4, metalness: 0.1 });
  riboMesh.castShadow = false;
  g.add(riboMesh);

  return g;
}

// Smooth ER: the same membrane system with no ribosomes on it, and tubular rather than
// flattened. Built as a tangle of connected tubes so the contrast with the rough ER's
// stacked sheets is visible from across the cell -- that contrast is the entire reason
// both are in this world.
export function smoothER({ extent = 15, strands = 9, seed = 21 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const parts = [];

  for (let i = 0; i < strands; i++) {
    const pts = [];
    let p = new THREE.Vector3(randomIn(rng, -extent, extent), randomIn(rng, 2, 9), randomIn(rng, -extent, extent));
    for (let k = 0; k < 7; k++) {
      pts.push([p.x, p.y, p.z]);
      p = p.clone().add(new THREE.Vector3(
        randomIn(rng, -1, 1),
        randomIn(rng, -0.5, 0.7),
        randomIn(rng, -1, 1),
      ).multiplyScalar(extent * 0.4));
      p.y = Math.max(1.6, Math.min(12, p.y));
    }
    const r = randomIn(rng, 0.5, 0.85);
    parts.push(tube(pts, pts.map(() => r), ER_MEMBRANE, { tubularSegments: 26, radialSegments: 10 }));
  }

  const m = mergedMesh(parts, { color: 0xffffff, roughness: 0.5, ...membraneRelief(seed, 5) });
  m.castShadow = false;
  g.add(m);
  return g;
}

// ---------------------------------------------------------------------------
// 4. The Golgi apparatus
// ---------------------------------------------------------------------------

// A stack of curved flattened sacs, biggest at the bottom, with vesicles pinching off the
// rims. The curve is what makes it a Golgi and not a pile of plates: real cisternae are
// dished, and the stack is always drawn as a shallow arc.
export function golgiBody({ width = 22, sacs = 6, seed = 17 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const parts = [];
  const buds = [];

  for (let s = 0; s < sacs; s++) {
    const t = s / (sacs - 1);
    const w = width * (1 - t * 0.34);
    const d = w * 0.5;
    const y = 2.2 + s * 2.5;

    const geometry = new THREE.PlaneGeometry(w, d, 26, 12);
    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const pz = pos.getY(i);
      // A dish: the sac curves UP at its ends. Quadratic in x, gentle in z.
      const dish = (px / (w / 2)) ** 2 * 2.1 + (pz / (d / 2)) ** 2 * 0.5;
      pos.setZ(i, dish);
    }
    geometry.computeVertexNormals();
    geometry.rotateX(-Math.PI / 2);

    // Thickness, same as the ER: a flattened sac seen edge-on must not vanish.
    for (const face of [0.28, -0.28]) {
      const gg = geometry.clone();
      gg.translate(0, y + face, 0);
      parts.push({ geometry: gg, color: s === 0 ? GOLGI_EDGE : GOLGI_SAC });
    }
    geometry.dispose();

    // Vesicles budding off the rim. They cluster toward the top of the stack, which is
    // the trans face -- the side finished product actually leaves from.
    const budCount = 2 + Math.round(t * 4);
    for (let i = 0; i < budCount; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const bx = side * (w / 2 + randomIn(rng, 0.4, 2.6));
      const bz = randomIn(rng, -d / 2, d / 2);
      const r = randomIn(rng, 0.55, 1.15);
      buds.push({ geometry: ball(r, 10), position: [bx, y + randomIn(rng, -0.4, 1.1), bz], color: VESICLE });
    }
  }

  const stack = mergedMesh(parts, {
    color: 0xffffff,
    roughness: 0.46,
    side: THREE.DoubleSide,
    ...membraneRelief(seed, 5),
  });
  stack.castShadow = false;
  g.add(stack);

  const budMesh = mergedMesh(buds, { color: 0xffffff, roughness: 0.35, metalness: 0.1 });
  budMesh.castShadow = false;
  g.add(budMesh);

  return g;
}

// ---------------------------------------------------------------------------
// 5. The cell membrane -- a diagram made solid
// ---------------------------------------------------------------------------

// A standing section of phospholipid bilayer, built exactly the way it is drawn: two rows
// of round heads facing out, their tails meeting in the middle, with proteins embedded
// through it and cholesterol wedged between the tails.
//
// This is the one model in the world that is a DIAGRAM rather than a shape -- and that is
// deliberate for the same reason Fantastic Voyage draws whole body systems as charts. The
// bilayer's meaning is entirely in the arrangement of its parts; a smooth curved wall
// coloured "membrane" would be accurate and would teach nothing.
export function membranePanel({ width = 30, height = 13, columns = 26, seed = 5 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const heads = [];
  const tails = [];

  const headR = width / columns * 0.46;
  const midY = height * 0.5;
  const gap = headR * 3.6;              // distance between the two head rows

  for (let c = 0; c < columns; c++) {
    const x = -width / 2 + (c + 0.5) * (width / columns);
    // A little vertical wander, because a bilayer is a fluid and a ruler-straight row of
    // beads reads as a machine part.
    const jitter = Math.sin(c * 0.9 + seed) * headR * 0.22;

    for (const side of [1, -1]) {
      const y = midY + side * gap / 2 + jitter;
      heads.push({ geometry: ball(headR, 10), position: [x, y, 0], color: MEMBRANE_HEAD });

      // Two tails per head, angled apart, reaching toward the middle. Two and not one:
      // a phospholipid has two fatty-acid tails and that is drawn in every diagram of it.
      for (const t of [-1, 1]) {
        const len = gap * 0.42;
        const geometry = new THREE.CylinderGeometry(headR * 0.2, headR * 0.16, len, 6);
        geometry.translate(0, -len / 2, 0);
        geometry.rotateZ(t * 0.22);
        geometry.rotateX(t * 0.1);
        const gg = geometry.clone();
        gg.rotateZ(side < 0 ? Math.PI : 0);
        gg.translate(x, y, 0);
        geometry.dispose();
        tails.push({ geometry: gg, color: MEMBRANE_TAIL });
      }
    }
  }

  const headMesh = mergedMesh(heads, { color: 0xffffff, roughness: 0.38, metalness: 0.08 });
  const tailMesh = mergedMesh(tails, { color: 0xffffff, roughness: 0.62 });
  headMesh.castShadow = false;
  tailMesh.castShadow = false;
  g.add(headMesh, tailMesh);

  // --- Embedded proteins ---------------------------------------------------
  // A channel protein spans the whole bilayer with a hole down the middle; a surface
  // protein sits on one face only. Both are chunky and opaque so they read against the
  // bead rows rather than getting lost in them.
  const proteins = [];
  for (const px of [-width * 0.28, width * 0.06, width * 0.34]) {
    const h = gap * 1.5;
    const outer = new THREE.CylinderGeometry(headR * 1.5, headR * 1.7, h, 14, 1, true);
    outer.translate(px, midY, 0);
    proteins.push({ geometry: outer, color: PROTEIN_BLUE });
    // The pore: a dark inner sleeve, so the channel reads as open rather than as a post.
    const bore = new THREE.CylinderGeometry(headR * 0.85, headR * 0.85, h * 1.01, 12, 1, true);
    bore.translate(px, midY, 0);
    proteins.push({ geometry: bore, color: 0x16283f });
  }
  const proteinMesh = mergedMesh(proteins, {
    color: 0xffffff,
    roughness: 0.5,
    metalness: 0.1,
    side: THREE.DoubleSide,
  });
  proteinMesh.castShadow = false;
  g.add(proteinMesh);

  // --- Cholesterol ---------------------------------------------------------
  // Small stiff plates wedged between the tails. They keep the membrane from going too
  // fluid or too rigid, which is the one thing they are ever asked about.
  const chol = [];
  for (let i = 0; i < 7; i++) {
    const x = randomIn(rng, -width * 0.44, width * 0.44);
    const geometry = new THREE.BoxGeometry(headR * 0.5, gap * 0.5, headR * 0.4);
    geometry.translate(x, midY + randomIn(rng, -gap * 0.12, gap * 0.12), randomIn(rng, -0.3, 0.3));
    chol.push({ geometry, color: 0xe0e6ee });
  }
  const cholMesh = mergedMesh(chol, { color: 0xffffff, roughness: 0.5 });
  cholMesh.castShadow = false;
  g.add(cholMesh);

  return g;
}

// ---------------------------------------------------------------------------
// Supporting organelles
// ---------------------------------------------------------------------------

// A lysosome: a plain sac full of digestive enzymes. Drawn as a sphere with granules
// inside it, which is exactly how it is drawn in a textbook -- there is no finer structure
// to show, and inventing one would be worse than showing none.
export function lysosome({ radius = 4.5, seed = 30 } = {}) {
  const g = group();
  const rng = seededRandom(seed);

  const shellGeo = ball(radius, 22);
  roughenSphere(shellGeo, { amount: 0.09, phase: seed });
  const shell = mesh(shellGeo, shellMaterial(LYSOSOME, 0.46, { ...membraneRelief(seed) }), 0, radius, 0);
  shell.castShadow = false;
  g.add(shell);

  const grains = [];
  for (let i = 0; i < 22; i++) {
    const dir = new THREE.Vector3(randomIn(rng, -1, 1), randomIn(rng, -1, 1), randomIn(rng, -1, 1))
      .normalize().multiplyScalar(radius * randomIn(rng, 0.1, 0.68));
    grains.push({
      geometry: ball(radius * randomIn(rng, 0.05, 0.1), 6),
      position: [dir.x, dir.y + radius, dir.z],
      color: 0xf2c8dd,
    });
  }
  const grainMesh = mergedMesh(grains, { color: 0xffffff, roughness: 0.4 });
  grainMesh.castShadow = false;
  g.add(grainMesh);
  return g;
}

// A transport vesicle -- the thing the coding challenge sends across the cell. Deliberately
// a SEPARATE prop rather than part of the Golgi, for the same reason the Park's geese were
// pulled out of the pond: anything a student is invited to program has to be a thing they
// can pick, and clicking a bud on the Golgi would select the whole Golgi.
export function transportVesicle({ radius = 2.6, cargo = 7, seed = 41 } = {}) {
  const g = group();
  const rng = seededRandom(seed);

  const shell = mesh(
    ball(radius, 20),
    shellMaterial(VESICLE, 0.55, { emissive: 0x1d5a52, ...membraneRelief(seed) }),
    0, radius, 0,
  );
  shell.castShadow = false;
  g.add(shell);

  // Cargo, so it is visibly CARRYING something. An empty bubble is not a transport vesicle.
  const load = [];
  for (let i = 0; i < cargo; i++) {
    const dir = new THREE.Vector3(randomIn(rng, -1, 1), randomIn(rng, -1, 1), randomIn(rng, -1, 1))
      .normalize().multiplyScalar(radius * randomIn(rng, 0.1, 0.5));
    load.push({
      geometry: ball(radius * randomIn(rng, 0.13, 0.22), 7),
      position: [dir.x, dir.y + radius, dir.z],
      color: 0xf0f6ff,
    });
  }
  const loadMesh = mergedMesh(load, { color: 0xffffff, roughness: 0.35, metalness: 0.12 });
  loadMesh.castShadow = false;
  g.add(loadMesh);
  return g;
}

// A free ribosome: the same two-subunit bead pair that studs the rough ER, at a size a
// student can walk up to. Placed loose in the cytosol, which is where about half of them
// genuinely are.
export function freeRibosome({ radius = 1.5 } = {}) {
  const parts = [
    { geometry: ball(radius, 14), position: [0, radius, 0], color: RIBOSOME },
    { geometry: ball(radius * 0.66, 14), position: [radius * 0.35, radius * 2.05, 0], color: 0x2f5794 },
  ];
  const g = group();
  g.add(mergedMesh(parts, { color: 0xffffff, roughness: 0.42, metalness: 0.12 }));
  return g;
}

// The centriole pair: two short barrels at right angles, each of nine triplet tubes.
//
// The 9-triplet arrangement is the whole identity of this organelle -- "9 x 3" is the fact
// every student is taught about it -- so the tubes are modelled individually rather than
// suggested by a texture. Nine groups of three, and the right angle between the two
// barrels, are what make it recognisable from any distance.
export function centriolePair({ length = 7, radius = 2.4 } = {}) {
  const g = group();
  const parts = [];

  const barrel = (matrix) => {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      for (let t = 0; t < 3; t++) {
        const rr = radius - t * radius * 0.17;
        const off = t * 0.16;
        const geometry = new THREE.CylinderGeometry(radius * 0.15, radius * 0.15, length, 8);
        geometry.rotateZ(Math.PI / 2);        // lie the tube along X
        geometry.translate(0, Math.sin(a + off) * rr, Math.cos(a + off) * rr);
        geometry.applyMatrix4(matrix);
        parts.push({ geometry, color: CENTRIOLE });
      }
    }
  };

  barrel(new THREE.Matrix4().makeTranslation(0, radius + 1.4, 0));
  barrel(new THREE.Matrix4()
    .makeTranslation(length * 0.62, radius + 1.4, 0)
    .multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)));

  const m = mergedMesh(parts, { color: 0xffffff, roughness: 0.42, metalness: 0.25 });
  g.add(m);
  return g;
}

// A length of cytoskeleton stretched across the cytosol. Not scenery: without it the space
// between organelles is empty and a cell reads as a room with furniture in it rather than
// as something with an internal structure holding everything in place.
export function cytoskeletonStrand({ length = 40, radius = 0.42, seed = 55 } = {}) {
  const rng = seededRandom(seed);
  const pts = [];
  const n = 5;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([
      (t - 0.5) * length,
      6 + Math.sin(t * Math.PI) * randomIn(rng, 2, 7),
      randomIn(rng, -2.5, 2.5),
    ]);
  }
  const g = group();
  const m = mergedMesh(
    [tube(pts, pts.map(() => radius), MICROTUBULE, { tubularSegments: 30, radialSegments: 8 })],
    { color: 0xffffff, roughness: 0.55, metalness: 0.15 },
  );
  m.castShadow = false;
  g.add(m);
  return g;
}

// A run of the cell's own boundary, curved, to stand at the edge of the world. This is the
// wall of the room -- the membranePanel above is the cutaway DIAGRAM of the same thing,
// and having both is the point: one shows what it is made of, the other shows where it is.
export function membraneWall({ span = 60, height = 16, curve = 0.18, seed = 9 } = {}) {
  const g = group();
  const geometry = new THREE.PlaneGeometry(span, height, 40, 8);
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    // Bow the wall away from the middle, so a ring of these reads as a round cell.
    pos.setZ(i, -((px / (span / 2)) ** 2) * span * curve);
  }
  geometry.computeVertexNormals();
  geometry.translate(0, height / 2, 0);

  const wall = mesh(geometry, standard({
    color: CYTOSOL_RIM,
    roughness: 0.5,
    metalness: 0.05,
    transparent: true,
    opacity: 0.3,
    side: THREE.DoubleSide,
    depthWrite: false,
    ...membraneRelief(seed, 8),
  }));
  wall.castShadow = false;
  wall.receiveShadow = false;
  g.add(wall);

  // A bead row along the top edge, so the wall reads as the same bilayer the cutaway panel
  // shows rather than as a pane of glass.
  const beads = [];
  const count = Math.round(span / 2.2);
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const px = (t - 0.5) * span;
    const pz = -((px / (span / 2)) ** 2) * span * curve;
    beads.push({ geometry: ball(0.62, 8), position: [px, height, pz], color: MEMBRANE_HEAD });
  }
  const beadMesh = mergedMesh(beads, { color: 0xffffff, roughness: 0.4 });
  beadMesh.castShadow = false;
  g.add(beadMesh);

  return g;
}
