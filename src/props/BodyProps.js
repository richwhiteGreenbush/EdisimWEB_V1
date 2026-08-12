import * as THREE from 'three';
import {
  standard,
  mesh,
  box,
  cyl,
  group,
  mergedMesh,
  canvasTexture,
  wrapText,
  signPanel,
  taperedTube,
  roughenSphere,
  seededRandom,
  randomIn,
} from '../PropKit.js';

// "Fantastic Voyage" -- a walk-through human-anatomy exhibition, built at exhibition
// scale rather than life size. A real liver is the size of a football; at that size a
// student cannot walk around it, read it, or see what it is joined to. Every organ here
// is enlarged roughly fifteen to twenty times, and each placard states the REAL size, so
// the enlargement teaches rather than misleads.
//
// The split the world is organised around:
//   * The four primary organs -- lungs, stomach, liver, kidneys -- are real 3D models
//     you can walk around, plus a heart, a brain and the intestines as supporting ones.
//   * Whole SYSTEMS are diagrams (anatomyChart), because a system is a set of
//     relationships and a labelled drawing shows relationships far better than geometry
//     does. Nothing here can show you where the ureters run by being walked around.
//
// House rules from PropKit.js apply: feet at scale 1, origin at base centre, fresh
// materials per call, seededRandom rather than Math.random.

// Tissue palette. Warm organ colours on purpose -- the `voyage` theme is cool teal and
// mauve so that these read as strongly as possible against it.
const LUNG_PINK = 0xe0989c;
const AIRWAY = 0xdfd2ac;
const MUSCLE = 0xa8413c;
const STOMACH_WALL = 0xd4837a;
const STOMACH_LINING = 0xb85f57;
const LIVER_BROWN = 0x8e4034;
const GALL_GREEN = 0x6e8a45;
const KIDNEY_RED = 0x9d4a3b;
const BLADDER = 0xd8c98a;
const ARTERY = 0xc0392b;
const VEIN = 0x40598f;
const BONE = 0xe4dbc4;
const NERVE_CREAM = 0xe7d6a6;
const STEEL = 0x39424c;
const GUT_PINK = 0xd0836f;

const CHART_INK = '#3c3730';
const CHART_PAPER = '#f6f1e4';
const CHART_TEAL = '#2f5d6b';

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

function tube(points, radii, color, options) {
  return { geometry: taperedTube(points, radii, options), color };
}

function ellipsoid(radius, [sx, sy, sz], detail = 20) {
  const geometry = new THREE.SphereGeometry(radius, detail, Math.max(8, detail >> 1));
  geometry.scale(sx, sy, sz);
  return geometry;
}

// A specimen stand: a weighted base plate and a rod up to `top`. Every organ model here
// is a shape that would not stand up on its own, exactly as a real museum specimen is.
function standParts(parts, { top, x = 0, z = 0, rod = 0.18, plate = 1.5, color = STEEL }) {
  parts.push({
    geometry: new THREE.CylinderGeometry(plate, plate * 1.12, 0.22, 22),
    position: [x, 0.11, z],
    color,
  });
  parts.push({
    geometry: new THREE.CylinderGeometry(rod, rod * 1.25, top, 12),
    position: [x, top / 2 + 0.2, z],
    color,
  });
}

// A ring sitting square across a curve at parameter t -- sphincters, cartilage rings,
// the muscle bands of a vessel. A TorusGeometry already lies in XY with its axis on +Z,
// so aligning +Z to the curve's tangent is the whole job. The rotation is baked into the
// geometry with a matrix because mergeColored() only carries Euler rotations, and this
// one is not expressible as an axis-aligned Euler triple.
function ringOnCurve(curve, t, radius, thickness, color, segments = 22) {
  const point = curve.getPointAt(t);
  const tangent = curve.getTangentAt(t).normalize();
  const geometry = new THREE.TorusGeometry(radius, thickness, 8, segments);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
  geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(quaternion));
  geometry.translate(point.x, point.y, point.z);
  return { geometry, color };
}

function curveThrough(points) {
  return new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
}

// ---------------------------------------------------------------------------
// Display plinth
// ---------------------------------------------------------------------------

function plinthLabelTexture(label, sublabel, accent) {
  return canvasTexture(768, 192, (ctx, w, h) => {
    ctx.fillStyle = '#141b21';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 7;
    ctx.strokeRect(12, 12, w - 24, h - 24);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#f2ece0';
    ctx.font = 'bold 74px Georgia, "Times New Roman", serif';
    ctx.fillText(String(label).toUpperCase(), w / 2, sublabel ? 92 : 118);

    if (sublabel) {
      ctx.fillStyle = accent;
      ctx.font = '34px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText(sublabel, w / 2, 146);
    }
  });
}

// The drum every organ model stands on. The name plate is a flat panel on the front and
// back rather than a texture wrapped round the drum: a texture on a cylinder's side is
// mirrored or stretched depending on which way you walk round it, and a name that reads
// backwards from one side of an exhibit is worse than no name at all.
export function organPlinth({ height = 3, radius = 3.6, label = '', sublabel = '', accent = '#5fc9dd' } = {}) {
  const g = group();
  const stone = standard({ color: 0x2b343d, roughness: 0.7, metalness: 0.15 });
  const cap = standard({ color: 0x3d4956, roughness: 0.5, metalness: 0.35 });

  g.add(cyl(radius * 1.1, radius * 1.16, 0.3, cap, 0, 0.15, 0, 40));
  g.add(cyl(radius, radius * 1.04, height - 0.6, stone, 0, height / 2, 0, 40));
  g.add(cyl(radius * 1.08, radius * 1.02, 0.3, cap, 0, height - 0.15, 0, 40));

  // A lit ring under the cap, so a plinth reads as an exhibit even before you get close
  // enough to read its plate.
  const glow = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 1.03, 0.09, 8, 44),
    standard({ color: 0xdff6fb, emissive: new THREE.Color(accent), emissiveIntensity: 2.2, roughness: 0.4 })
  );
  glow.rotation.x = Math.PI / 2;
  glow.position.y = height - 0.42;
  g.add(glow);

  if (label) {
    const texture = plinthLabelTexture(label, sublabel, accent);
    for (const facing of [0, Math.PI]) {
      const plate = signPanel(radius * 1.5, radius * 0.375, texture);
      plate.position.set(Math.sin(facing) * (radius * 1.02), height * 0.55, Math.cos(facing) * (radius * 1.02));
      plate.rotation.y = facing;
      g.add(plate);
    }
  }

  return g;
}

// ---------------------------------------------------------------------------
// PRIMARY ORGAN 1 -- the lungs
// ---------------------------------------------------------------------------

// Trachea, bronchial tree and five lobes -- three on the body's right, two on the left,
// which is the single most useful fact about lung shape and is visible here at a glance.
//
// The lobes are TRANSLUCENT and castShadow is off on them, for the same reason the Mars
// dome's glazing is: three.js transmits no light through a transparent material, so an
// opaque lung would put its own bronchial tree in total darkness and the whole point of
// the model would be invisible from outside.
export function lungsModel({ height = 16 } = {}) {
  const g = group();
  // Opacity is a balance, and both ends of it are wrong: fully opaque hides the airway
  // tree that is the whole reason for the model, and much below this the lobes stop
  // reading as tissue and turn into glass bulbs with sticks in them. The colour is
  // deliberately more saturated than a real lung, because a see-through surface loses
  // most of its apparent colour.
  const lobeMaterial = standard({
    color: 0xd07f89,
    roughness: 0.6,
    transparent: true,
    opacity: 0.68,
    side: THREE.DoubleSide,
  });

  // --- Airway: trachea, cartilage rings, bronchi, segmental branches -------
  const airway = [];
  airway.push({
    geometry: new THREE.CylinderGeometry(0.8, 0.86, 4.6, 20),
    position: [0, 13.3, 0],
    color: AIRWAY,
  });
  // The C-shaped cartilage rings that keep the windpipe from collapsing. Kept thin and
  // widely spaced: at a fatter tube radius they swallowed the trachea entirely and the
  // whole assembly read as a spring balanced on a wishbone.
  for (let i = 0; i < 7; i++) {
    const ring = new THREE.TorusGeometry(0.88, 0.085, 6, 22);
    ring.rotateX(Math.PI / 2);
    airway.push({ geometry: ring, position: [0, 11.5 + i * 0.62, 0], color: 0xcfc094 });
  }

  // Main bronchi. The right one is deliberately steeper and wider -- which is why an
  // inhaled object almost always ends up in the right lung.
  airway.push(tube([[0, 11.2, 0], [-1.6, 10.2, 0.1], [-3.4, 9.0, 0.2]], [0.72, 0.62, 0.5], AIRWAY));
  airway.push(tube([[0, 11.2, 0], [1.4, 10.3, 0.1], [3.2, 9.4, 0.2]], [0.72, 0.58, 0.46], AIRWAY));

  const branches = [
    [[-3.4, 9.0, 0.2], [-4.4, 9.8, 0.4], [-5.2, 10.2, 0.8]],
    [[-3.4, 9.0, 0.2], [-4.6, 7.9, 0.6], [-5.6, 7.2, 1.0]],
    [[-3.4, 9.0, 0.2], [-4.2, 6.6, 0.0], [-5.0, 4.6, -0.4]],
    [[3.2, 9.4, 0.2], [4.2, 10.2, 0.5], [5.0, 10.6, 0.9]],
    [[3.2, 9.4, 0.2], [4.2, 7.2, 0.1], [5.0, 5.0, -0.3]],
  ];
  for (const points of branches) airway.push(tube(points, [0.42, 0.3, 0.16], AIRWAY, { tubularSegments: 16 }));

  g.add(mergedMesh(airway, { roughness: 0.7 }));

  // --- Lobes ---------------------------------------------------------------
  // Right lung (body's right, -X here): upper, middle, lower.
  // Left lung: upper and lower only, and narrower, because the heart takes the space.
  const lobes = [
    [-4.9, 9.4, 0.1, 2.9, 2.2, 2.5, 3],
    [-5.1, 7.0, 0.5, 2.7, 1.2, 2.2, 9],
    [-4.9, 4.4, -0.2, 3.0, 2.4, 2.6, 15],
    [4.8, 9.2, 0.1, 2.6, 2.5, 2.4, 21],
    [4.9, 4.6, -0.2, 2.7, 2.5, 2.5, 27],
  ];
  for (const [x, y, z, sx, sy, sz, phase] of lobes) {
    const geometry = ellipsoid(1, [sx, sy, sz], 22);
    roughenSphere(geometry, { amount: 0.1, phase });
    const lobe = mesh(geometry, lobeMaterial, x, y, z);
    lobe.castShadow = false;
    g.add(lobe);
  }

  // --- Diaphragm ------------------------------------------------------------
  // The muscle that actually does the breathing: it pulls DOWN and the lungs fill.
  //
  // Narrower than the lungs are wide, and domed rather than flat. Built at the obvious
  // "wide enough to sit under everything" radius it came out as a red pancake broader
  // than the organ it belongs to, and read as a table the lungs were standing on.
  const diaphragm = mesh(
    new THREE.SphereGeometry(6.4, 34, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    standard({ color: MUSCLE, roughness: 0.8, side: THREE.DoubleSide }),
    0,
    0.4,
    0
  );
  diaphragm.scale.y = 0.34;
  g.add(diaphragm);

  return g;
}

// ---------------------------------------------------------------------------
// PRIMARY ORGAN 2 -- the stomach
// ---------------------------------------------------------------------------

// The J-curve is the whole shape, so the stomach is swept as one tapered tube along its
// own axis rather than assembled from blobs: oesophagus in narrow at the top, the body
// ballooning out, the antrum narrowing to the pylorus, then the duodenum leaving.
//
// The outer wall is translucent over a solid lining, so the rugae -- the folds that let
// an empty stomach stretch to four times its size -- are visible from outside.
export function stomachModel({ height = 13 } = {}) {
  const g = group();

  const path = [
    [-1.1, 12.6, 0],
    [-1.3, 10.6, 0],
    [-2.6, 8.8, 0],
    [-2.3, 6.0, 0],
    [-0.3, 3.9, 0],
    [2.4, 3.4, 0],
    [4.5, 4.6, 0],
    [5.3, 6.8, 0],
  ];
  const wallRadii = [0.55, 1.05, 2.65, 2.9, 2.2, 1.05, 0.85, 0.8];
  const curve = curveThrough(path);

  const wall = mesh(
    taperedTube(path, wallRadii, { tubularSegments: 60, radialSegments: 18 }),
    standard({
      color: STOMACH_WALL,
      roughness: 0.55,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
    })
  );
  wall.castShadow = false;
  g.add(wall);

  // Fundus: the dome that sits ABOVE the entrance and holds swallowed air. It is not on
  // the tube's axis, so it is its own solid rather than part of the sweep.
  const fundus = mesh(
    ellipsoid(1, [2.5, 2.1, 2.3], 22),
    standard({ color: STOMACH_WALL, roughness: 0.55, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    -3.0,
    10.2,
    0
  );
  fundus.castShadow = false;
  g.add(fundus);

  // --- Lining, rugae and the two sphincters --------------------------------
  const inner = [];
  inner.push(
    tube(path, wallRadii.map((r) => r * 0.74), STOMACH_LINING, { tubularSegments: 54, radialSegments: 16 })
  );
  // Each rugal fold has to be sized from the INTERPOLATED wall radius at its own point on
  // the curve, exactly the way taperedTube resamples them. Taking the radius from the
  // nearest control point instead, the folds down in the narrowing antrum came out
  // oversized and hung outside the stomach wall like loose bangles.
  for (let i = 2; i <= 10; i++) {
    const t = 0.16 + (i / 12) * 0.62;
    const span = (wallRadii.length - 1) * t;
    const index = Math.min(wallRadii.length - 2, Math.floor(span));
    const radius = THREE.MathUtils.lerp(wallRadii[index], wallRadii[index + 1], span - index) * 0.78;
    inner.push(ringOnCurve(curve, t, radius, 0.16, 0x9d4c46));
  }
  // Cardiac sphincter (keeps acid out of the oesophagus) and pyloric sphincter (meters
  // food into the intestine a teaspoon at a time).
  inner.push(ringOnCurve(curve, 0.135, 1.15, 0.3, MUSCLE));
  inner.push(ringOnCurve(curve, 0.735, 1.15, 0.32, MUSCLE));
  g.add(mergedMesh(inner, { roughness: 0.72 }));

  const frame = [];
  standParts(frame, { top: 3.6, x: 1.2, z: -1.6 });
  standParts(frame, { top: 2.6, x: -2.4, z: 1.4, plate: 1.2 });
  g.add(mergedMesh(frame, { roughness: 0.45, metalness: 0.6 }));

  return g;
}

// ---------------------------------------------------------------------------
// PRIMARY ORGAN 3 -- the liver
// ---------------------------------------------------------------------------

// A large right lobe and a smaller left one, split by the falciform ligament, with the
// gallbladder tucked underneath and the three vessels of the porta hepatis entering from
// below. The wedge shape is the recognisable thing about a liver, so the lobes are
// flattened ellipsoids rather than spheres.
export function liverModel() {
  const g = group();
  const parts = [];

  const right = ellipsoid(1, [4.6, 2.5, 3.1], 24);
  roughenSphere(right, { amount: 0.09, phase: 2 });
  parts.push({ geometry: right, position: [-2.4, 3.6, 0], color: LIVER_BROWN });

  const left = ellipsoid(1, [2.7, 1.8, 2.5], 22);
  roughenSphere(left, { amount: 0.09, phase: 5 });
  parts.push({ geometry: left, position: [3.7, 3.5, 0.2], color: 0x9a4a3c });

  // Falciform ligament -- the sheet of tissue that anchors the liver to the abdominal
  // wall and marks the boundary between the two lobes.
  parts.push({
    geometry: new THREE.BoxGeometry(0.18, 2.6, 3.2),
    position: [1.1, 3.9, 0.1],
    color: 0xd9c3ab,
  });

  parts.push({ geometry: ellipsoid(1, [0.85, 0.7, 1.5], 16), position: [-2.2, 1.9, 1.7], color: GALL_GREEN });
  parts.push(tube([[-2.2, 1.9, 1.7], [-1.2, 1.9, 2.4], [0.4, 2.2, 2.6]], [0.3, 0.22, 0.16], GALL_GREEN));

  // Porta hepatis: portal vein (blue -- blood arriving from the gut), hepatic artery
  // (red -- oxygen), bile duct (green -- bile leaving).
  parts.push(tube([[-1.4, 2.1, 0.2], [-1.0, 1.2, 1.0], [-0.6, 0.4, 1.8]], [0.55, 0.5, 0.45], VEIN));
  parts.push(tube([[-0.2, 2.2, -0.4], [0.2, 1.3, 0.4], [0.6, 0.5, 1.2]], [0.34, 0.3, 0.26], ARTERY));

  standParts(parts, { top: 2.4, x: -3.4, z: -1.5 });
  standParts(parts, { top: 2.4, x: 3.2, z: -1.4, plate: 1.2 });

  g.add(mergedMesh(parts, { roughness: 0.6 }));
  return g;
}

// ---------------------------------------------------------------------------
// PRIMARY ORGAN 4 -- the kidneys
// ---------------------------------------------------------------------------

// The whole urinary tract in one exhibit, because a kidney on its own does not explain
// itself: two kidneys, the renal artery and vein at each hilum, both ureters running
// down, and the bladder they drain into.
//
// The bean shape comes straight out of taperedTube -- a C-shaped path with a fat middle
// IS a kidney, and the concave side of the C is the hilum where everything plugs in.
export function kidneyModel({ withBladder = true } = {}) {
  const g = group();
  const parts = [];
  const kidneyY = 7.4;

  for (const side of [-1, 1]) {
    // The right kidney (body's right, -X) rides lower, pushed down by the liver above it.
    const y = kidneyY + (side < 0 ? -0.7 : 0);
    const x = side * 3.6;
    const hilumX = x - side * 1.0;

    const bean = taperedTube(
      [
        [x + side * 1.0, y - 2.6, 0],
        [x - side * 0.5, y - 1.6, 0],
        [x - side * 0.9, y, 0],
        [x - side * 0.5, y + 1.6, 0],
        [x + side * 1.0, y + 2.6, 0],
      ],
      [0.45, 1.5, 1.75, 1.5, 0.45],
      { tubularSegments: 34, radialSegments: 16 }
    );
    bean.scale(1, 1, 0.82);
    parts.push({ geometry: bean, color: KIDNEY_RED });

    parts.push(
      tube(
        [[hilumX, y + 0.5, 0], [hilumX + side * -1.6, y + 0.7, 0.2], [hilumX + side * -3.0, y + 0.9, 0.3]],
        [0.34, 0.32, 0.3],
        ARTERY
      )
    );
    parts.push(
      tube(
        [[hilumX, y - 0.4, 0.3], [hilumX + side * -1.6, y - 0.5, 0.5], [hilumX + side * -3.0, y - 0.6, 0.6]],
        [0.4, 0.38, 0.36],
        VEIN
      )
    );

    if (withBladder) {
      parts.push(
        tube(
          [
            [hilumX, y - 1.2, 0],
            [hilumX + side * 0.4, y - 3.4, 0.2],
            [side * 1.4, 3.6, 0.3],
            [side * 0.7, 2.5, 0.2],
          ],
          [0.28, 0.24, 0.22, 0.2],
          0xe3d3ae
        )
      );
    }
  }

  if (withBladder) {
    const bag = ellipsoid(1, [2.2, 1.9, 2.0], 22);
    roughenSphere(bag, { amount: 0.07, phase: 3 });
    parts.push({ geometry: bag, position: [0, 2.0, 0], color: BLADDER });
    parts.push(tube([[0, 0.9, 0], [0, 0.4, 0.1], [0, 0.05, 0.2]], [0.26, 0.22, 0.2], 0xd9c88c));
  }

  standParts(parts, { top: kidneyY - 2.4, x: -3.6, z: -1.6, plate: 1.3 });
  standParts(parts, { top: kidneyY - 1.7, x: 3.6, z: -1.6, plate: 1.3 });

  g.add(mergedMesh(parts, { roughness: 0.62 }));
  return g;
}

// ---------------------------------------------------------------------------
// Supporting organ models
// ---------------------------------------------------------------------------

// Four chambers, the great vessels, and the coronary arteries that feed the muscle
// itself. Coloured the way every anatomy textbook colours it: the right side blue
// because the blood there is on its way TO the lungs, the left side red because it has
// just come back oxygenated. That colour convention is the teaching point.
export function heartModel() {
  const g = group();
  const parts = [];
  const leftRed = 0xb8362f;
  const rightBlue = 0x455f95;

  const lv = ellipsoid(1, [2.4, 3.2, 2.4], 22);
  roughenSphere(lv, { amount: 0.08, phase: 1 });
  parts.push({ geometry: lv, position: [1.3, 5.0, 0], color: leftRed });

  const rv = ellipsoid(1, [2.3, 2.9, 2.4], 22);
  roughenSphere(rv, { amount: 0.08, phase: 4 });
  parts.push({ geometry: rv, position: [-1.4, 4.7, 0.3], color: rightBlue });

  // The apex -- the pointed bottom tip that you can feel beating against the ribs.
  const apex = new THREE.ConeGeometry(1.9, 2.8, 20);
  apex.rotateX(Math.PI);
  parts.push({ geometry: apex, position: [0.8, 2.4, 0.1], color: leftRed });

  parts.push({ geometry: ellipsoid(1, [1.7, 1.4, 1.6], 18), position: [1.5, 8.3, -0.4], color: 0xa0362f });
  parts.push({ geometry: ellipsoid(1, [1.8, 1.5, 1.7], 18), position: [-1.5, 8.1, 0.2], color: 0x3d5488 });

  // Aortic arch, with the three head-and-arm branches coming off the top of it.
  parts.push(
    tube(
      [[0.9, 8.6, -0.2], [0.6, 10.6, -0.6], [-0.6, 11.6, -1.0], [-2.0, 10.6, -1.2], [-2.4, 8.6, -1.2]],
      [0.85, 0.8, 0.78, 0.74, 0.7],
      ARTERY,
      { tubularSegments: 30 }
    )
  );
  for (const [x, z] of [[0.2, -0.9], [-0.7, -1.05], [-1.5, -1.1]]) {
    parts.push(tube([[x, 11.3, z], [x, 12.2, z - 0.1], [x, 13.0, z - 0.2]], [0.3, 0.26, 0.22], ARTERY, { tubularSegments: 10 }));
  }

  // Pulmonary trunk, splitting to both lungs.
  parts.push(tube([[-0.6, 8.4, 0.9], [-0.4, 10.0, 0.6], [-0.2, 11.2, 0.2]], [0.75, 0.7, 0.6], rightBlue));
  for (const side of [-1, 1]) {
    parts.push(
      tube([[-0.2, 11.2, 0.2], [side * 1.6, 11.3, 0.1], [side * 3.0, 11.2, 0]], [0.5, 0.42, 0.36], rightBlue, {
        tubularSegments: 12,
      })
    );
  }

  // Superior and inferior vena cava -- the two big veins delivering blood back.
  parts.push(tube([[-2.6, 12.4, 0.4], [-2.5, 10.6, 0.4], [-2.2, 9.0, 0.3]], [0.62, 0.66, 0.7], VEIN));
  parts.push(tube([[-2.0, 2.4, 0.6], [-2.2, 4.4, 0.6], [-2.3, 6.6, 0.5]], [0.6, 0.64, 0.68], VEIN));

  // Coronary arteries: the heart is a pump that has to pump to itself.
  parts.push(
    tube(
      [[0.1, 7.8, 1.9], [1.6, 6.6, 2.0], [2.4, 4.8, 1.5], [2.0, 3.4, 0.9]],
      [0.2, 0.18, 0.15, 0.11],
      0xd9534f,
      { tubularSegments: 22, radialSegments: 6 }
    )
  );
  parts.push(
    tube(
      [[-0.2, 7.8, 1.8], [-1.6, 6.8, 1.6], [-2.4, 5.2, 0.9]],
      [0.18, 0.15, 0.11],
      0xd9534f,
      { tubularSegments: 16, radialSegments: 6 }
    )
  );

  standParts(parts, { top: 2.2, x: -2.6, z: -2.0, plate: 1.3 });
  standParts(parts, { top: 2.6, x: 2.6, z: -2.0, plate: 1.3 });

  g.add(mergedMesh(parts, { roughness: 0.55 }));
  return g;
}

// Cerebrum in two hemispheres with a visible longitudinal fissure, cerebellum behind and
// below, brain stem running down into a length of spinal cord that doubles as the stand.
//
// The folds come from roughenSphere() at a high amount -- a smooth ball reads as a
// helmet, and the folding IS the interesting fact (it triples the surface area that has
// to fit inside a skull).
export function brainModel() {
  const g = group();
  const parts = [];
  const cortex = 0xd7a9a2;
  const lift = 6.6;

  // The cut-away base of the skull, with the brain sitting down inside it.
  //
  // This is here to solve a shape problem as much as to teach one: a brain modelled as a
  // lobed mass on top of a vertical stem is, to the eye, a tree, and no amount of
  // thinning the stem fixes that on its own. Seating it in a bowl of bone gives the
  // exhibit a base, hides the join, and says the one thing about the brain that the
  // lumps alone cannot -- it lives inside a box.
  // Deliberately NARROWER than the brain and shallow. Sized to actually contain it, the
  // bowl's rim sits above a 5ft student's eye line and hides the entire exhibit inside
  // itself -- the brain has to overhang the bone, not sit down in it.
  const cradle = mesh(
    new THREE.SphereGeometry(3.3, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    standard({ color: BONE, roughness: 0.8, side: THREE.DoubleSide }),
    0,
    lift + 0.2,
    -0.5
  );
  cradle.scale.set(1, 0.55, 1.15);
  cradle.castShadow = false;
  g.add(cradle);

  // The hemispheres nearly touch, leaving a visible midline fissure. Pushed apart far
  // enough to read as "two", they stop reading as one brain and become two lumps.
  for (const side of [-1, 1]) {
    const hemisphere = ellipsoid(1, [2.6, 2.4, 3.5], 30);
    roughenSphere(hemisphere, { amount: 0.32, phase: side > 0 ? 1.4 : 4.2 });
    parts.push({ geometry: hemisphere, position: [side * 2.35, lift + 2.0, -0.3], color: cortex });
  }

  for (const side of [-1, 1]) {
    const cerebellum = ellipsoid(1, [1.8, 1.2, 1.6], 20);
    roughenSphere(cerebellum, { amount: 0.3, phase: side > 0 ? 2.6 : 5.9 });
    parts.push({ geometry: cerebellum, position: [side * 1.5, lift - 0.3, -3.0], color: 0xbe8a80 });
  }

  // Brain stem, then the spinal cord running down to the base.
  //
  // Both are deliberately SLENDER and the cord is a paler colour than the cortex. Built
  // at the radius that felt structurally right -- around a foot thick, in the same pink
  // -- the result was a fat trunk under a lumpy canopy and the whole exhibit read as a
  // tree rather than as a brain.
  parts.push(tube([[0, lift + 1.2, -1.3], [0, lift + 0.2, -1.8], [0, lift - 0.8, -2.0]], [0.95, 0.78, 0.62], 0xdcb4a4));
  parts.push(
    tube([[0, lift - 0.8, -2.0], [0, lift - 2.6, -2.2], [0, lift - 4.4, -2.4], [0, lift - 6.2, -2.5]],
      [0.6, 0.5, 0.44, 0.4], 0xe8d4bc, { tubularSegments: 20 })
  );

  standParts(parts, { top: lift - 0.6, x: 0, z: -3.9, plate: 1.9 });
  g.add(mergedMesh(parts, { roughness: 0.68 }));
  return g;
}

// The small intestine coiled inside the frame of the large intestine, which is exactly
// how they sit in the abdomen -- the colon runs up the right side, across, and down the
// left, and the small intestine fills the middle.
export function intestineCoil({ turns = 4.2, seed = 5 } = {}) {
  const g = group();
  const parts = [];
  const rng = seededRandom(seed);

  // A real small intestine is a jumble of loops, not a spring. Built as a clean helix
  // whose rise per turn was smaller than the tube's own diameter, consecutive turns
  // merged into each other and the whole thing read as a stack of flat sausages -- so
  // the radius, the height and the depth all wobble on different frequencies, which is
  // what stops any two loops sitting parallel.
  const coil = [];
  const steps = 66;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = t * Math.PI * 2 * turns;
    const radius = 3.5 - t * 1.0 + Math.sin(angle * 2.3) * 0.85 + Math.cos(angle * 0.9) * 0.45;
    coil.push([
      Math.cos(angle) * radius,
      1.7 + t * 4.6 + Math.sin(angle * 1.6) * 0.75,
      Math.sin(angle) * radius * 0.8 + Math.sin(angle * 3.1) * 0.35 + randomIn(rng, -0.1, 0.1),
    ]);
  }
  parts.push(tube(coil, coil.map(() => 0.66), GUT_PINK, { tubularSegments: 180, radialSegments: 10 }));

  // Large intestine: caecum bottom-right, ascending, transverse, descending, sigmoid.
  const colonPath = [
    [-5.4, 0.9, -1.6],
    [-5.7, 3.2, -1.7],
    [-5.5, 6.4, -1.7],
    [-2.0, 7.6, -1.6],
    [2.0, 7.6, -1.6],
    [5.5, 6.4, -1.7],
    [5.7, 3.4, -1.7],
    [4.6, 1.4, -1.5],
    [1.6, 0.9, -1.2],
    [0.2, 0.4, -0.9],
  ];
  const colonRadii = [1.35, 1.25, 1.2, 1.15, 1.15, 1.2, 1.15, 1.05, 0.95, 0.8];
  parts.push(tube(colonPath, colonRadii, 0xc07a5f, { tubularSegments: 90, radialSegments: 12 }));

  // Haustra -- the pouches that make a colon look like a string of sausages rather than
  // a smooth hose. Drawn as the constrictions BETWEEN the pouches, which is what they
  // actually are: bands of muscle pinching the tube in.
  const colonCurve = curveThrough(colonPath);
  for (let i = 1; i < 16; i++) {
    const t = i / 16;
    const span = (colonRadii.length - 1) * t;
    const index = Math.min(colonRadii.length - 2, Math.floor(span));
    const radius = THREE.MathUtils.lerp(colonRadii[index], colonRadii[index + 1], span - index);
    parts.push(ringOnCurve(colonCurve, t, radius * 0.97, 0.15, 0xa9654e));
  }

  standParts(parts, { top: 1.4, x: -5.6, z: -1.6, plate: 1.4 });
  standParts(parts, { top: 1.4, x: 5.6, z: -1.6, plate: 1.4 });

  g.add(mergedMesh(parts, { roughness: 0.66 }));
  return g;
}

// A single alveolar sac wrapped in its capillary net, at a scale where a student can see
// what is actually happening: this is the only place in the body where air and blood
// come within a fraction of a millimetre of each other.
export function alveoliCluster({ height = 10, seed = 7 } = {}) {
  const g = group();
  const parts = [];
  const rng = seededRandom(seed);

  parts.push(tube([[0, 0.2, 0], [0, 2.2, 0], [0, 4.4, 0]], [0.55, 0.5, 0.46], AIRWAY));

  const clusters = [
    [-2.2, height - 2.6, 0.4],
    [2.3, height - 2.2, -0.5],
    [0.2, height - 0.4, 0.6],
  ];
  for (const [cx, cy, cz] of clusters) {
    parts.push(tube([[0, 4.4, 0], [cx * 0.6, (4.4 + cy) / 2, cz * 0.6], [cx, cy - 1.2, cz]], [0.4, 0.3, 0.24], AIRWAY, {
      tubularSegments: 14,
    }));

    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const lift = randomIn(rng, -0.5, 0.7);
      const radius = randomIn(rng, 0.85, 1.25);
      parts.push({
        geometry: new THREE.SphereGeometry(radius, 14, 10),
        position: [cx + Math.cos(angle) * 1.35, cy + lift, cz + Math.sin(angle) * 1.35],
        color: 0xf0b8b6,
      });
    }
    parts.push({ geometry: new THREE.SphereGeometry(1.1, 14, 10), position: [cx, cy + 0.2, cz], color: 0xf0b8b6 });

    // Capillary net over the sac.
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.TorusGeometry(2.1 + i * 0.1, 0.14, 6, 26);
      ring.rotateX(randomIn(rng, 0.3, 1.2));
      ring.rotateY(randomIn(rng, 0, Math.PI));
      parts.push({ geometry: ring, position: [cx, cy + 0.1, cz], color: i === 1 ? VEIN : 0xc2453c });
    }
  }

  standParts(parts, { top: 0.6, x: 0, z: 0, plate: 1.6 });
  g.add(mergedMesh(parts, { roughness: 0.6 }));
  return g;
}

// The finger-like projections that line the small intestine. Ground cover for the
// digestive end of the exhibition -- and the reason the small intestine has the surface
// area of a studio flat folded into a 22-foot tube.
export function villiPatch({ count = 44, radius = 6, seed = 11 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];

  const mat = new THREE.CircleGeometry(radius * 1.05, 34);
  mat.rotateX(-Math.PI / 2);
  parts.push({ geometry: mat, position: [0, 0.06, 0], color: 0xb9705f });

  for (let i = 0; i < count; i++) {
    const angle = rng() * Math.PI * 2;
    const distance = Math.sqrt(rng()) * radius * 0.94;
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;
    const height = randomIn(rng, 1.5, 2.8);
    const lean = randomIn(rng, -0.35, 0.35);
    parts.push(
      tube(
        [
          [x, 0.1, z],
          [x + lean * 0.4, height * 0.55, z + lean * 0.3],
          [x + lean, height, z + lean * 0.7],
        ],
        [0.3, 0.26, 0.16],
        i % 5 === 0 ? 0xd9907c : GUT_PINK,
        { tubularSegments: 10, radialSegments: 7 }
      )
    );
  }

  return group(mergedMesh(parts, { roughness: 0.7 }));
}

// ---------------------------------------------------------------------------
// Cells and molecules
// ---------------------------------------------------------------------------

// Red cells, white cells and platelets adrift in plasma. Everything floats: this prop is
// meant to hang inside the artery tunnel and above the walkways, so its contents occupy
// the volume ABOVE its origin rather than resting on it.
//
// A red cell's biconcave dimple is a LatheGeometry profile rather than a squashed sphere,
// because the dimple is the functional detail -- it is what gives the cell the extra
// surface area and the flexibility to fold through a capillary narrower than itself.
export function bloodCells({ count = 16, radius = 7, height = 11, seed = 5 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];

  const profile = [
    [0.02, -0.1],
    [0.36, -0.15],
    [0.64, -0.22],
    [0.86, -0.23],
    [1.0, 0],
    [0.86, 0.23],
    [0.64, 0.22],
    [0.36, 0.15],
    [0.02, 0.1],
  ].map(([x, y]) => new THREE.Vector2(x, y));

  for (let i = 0; i < count; i++) {
    const x = randomIn(rng, -radius, radius);
    const z = randomIn(rng, -radius, radius);
    const y = randomIn(rng, height * 0.3, height);
    const roll = [randomIn(rng, 0, Math.PI), randomIn(rng, 0, Math.PI), randomIn(rng, 0, Math.PI)];

    if (i % 7 === 3) {
      const white = new THREE.SphereGeometry(randomIn(rng, 1.1, 1.5), 18, 12);
      roughenSphere(white, { amount: 0.22, phase: i });
      parts.push({ geometry: white, position: [x, y, z], color: 0xe8eef2 });
    } else if (i % 7 === 5) {
      parts.push({
        geometry: new THREE.CylinderGeometry(0.55, 0.55, 0.2, 12),
        rotation: roll,
        position: [x, y, z],
        color: 0xe0c4a8,
      });
    } else {
      const cell = new THREE.LatheGeometry(profile, 22);
      cell.scale(1.5, 1.5, 1.5);
      parts.push({ geometry: cell, rotation: roll, position: [x, y, z], color: 0xb8352c });
    }
  }

  return group(mergedMesh(parts, { roughness: 0.5, flatShading: false }));
}

// An animal cell with its organelles. The membrane and the nuclear envelope are
// translucent and cast no shadow, which is the only way the inside of the cell is
// visible and lit from outside.
export function cellModel({ radius = 6 } = {}) {
  const g = group();
  const centre = radius + 0.5;
  const rng = seededRandom(23);

  const membrane = mesh(
    new THREE.SphereGeometry(radius, 40, 26),
    standard({
      color: 0x9fd8e6,
      transparent: true,
      opacity: 0.22,
      roughness: 0.15,
      side: THREE.DoubleSide,
      emissive: new THREE.Color(0x1e5567),
      emissiveIntensity: 0.5,
    }),
    0,
    centre,
    0
  );
  membrane.castShadow = false;
  membrane.receiveShadow = false;
  g.add(membrane);

  const nucleus = mesh(
    new THREE.SphereGeometry(radius * 0.36, 26, 18),
    standard({ color: 0x8a6bb5, transparent: true, opacity: 0.62, roughness: 0.5 }),
    -radius * 0.12,
    centre + radius * 0.1,
    0
  );
  nucleus.castShadow = false;
  g.add(nucleus);

  const parts = [];
  parts.push({
    geometry: new THREE.SphereGeometry(radius * 0.14, 16, 12),
    position: [-radius * 0.12, centre + radius * 0.1, 0],
    color: 0x5c3f86,
  });

  // Mitochondria -- the "powerhouses", drawn as capsules because that is their shape.
  // Placement radii are kept well inside the membrane: an organelle's own half-length
  // adds to its centre distance, so a range that looks safe on paper puts the outermost
  // ones poking through the cell wall.
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2 + 0.4;
    const distance = radius * randomIn(rng, 0.46, 0.64);
    const capsule = new THREE.CapsuleGeometry(radius * 0.075, radius * 0.26, 6, 12);
    capsule.rotateZ(randomIn(rng, -1.2, 1.2));
    capsule.rotateY(angle);
    parts.push({
      geometry: capsule,
      position: [Math.cos(angle) * distance, centre + randomIn(rng, -0.5, 0.6) * radius * 0.6, Math.sin(angle) * distance],
      color: 0xd88a3c,
    });
  }

  // Golgi apparatus: a stack of flattened, slightly curved sacs.
  for (let i = 0; i < 4; i++) {
    const sac = new THREE.TorusGeometry(radius * 0.2, radius * 0.03, 6, 20, Math.PI * 1.1);
    sac.scale(1, 0.4, 1);
    parts.push({
      geometry: sac,
      rotation: [Math.PI / 2, 0.6, 0],
      position: [radius * 0.44, centre - radius * 0.34 + i * radius * 0.09, radius * 0.2],
      color: 0x46a08c,
    });
  }

  // Endoplasmic reticulum: folded sheets wrapped around the nucleus.
  for (let i = 0; i < 3; i++) {
    const sheet = new THREE.TorusGeometry(radius * (0.46 + i * 0.06), radius * 0.025, 6, 30, Math.PI * 1.3);
    sheet.scale(1, 0.55, 1);
    parts.push({
      geometry: sheet,
      rotation: [Math.PI / 2 + randomIn(rng, -0.3, 0.3), randomIn(rng, 0, Math.PI), 0],
      position: [-radius * 0.1, centre + randomIn(rng, -0.2, 0.2) * radius, 0],
      color: 0xd0728a,
    });
  }

  for (let i = 0; i < 9; i++) {
    const angle = rng() * Math.PI * 2;
    const distance = radius * randomIn(rng, 0.28, 0.68);
    parts.push({
      geometry: new THREE.SphereGeometry(radius * randomIn(rng, 0.035, 0.07), 10, 8),
      position: [
        Math.cos(angle) * distance,
        centre + randomIn(rng, -0.7, 0.7) * radius * 0.7,
        Math.sin(angle) * distance,
      ],
      color: 0xf0d97a,
    });
  }

  const organelles = mergedMesh(parts, { roughness: 0.55 });
  organelles.castShadow = false;
  g.add(organelles);

  // A cradle ring, so a 12ft ball has something to sit in. Its radius is derived from
  // where the sphere actually IS at the ring's height, not picked by eye -- set wider,
  // the ball appears to hover inside a hoop it never touches.
  const ringY = radius * 0.2;
  const ringRadius = Math.sqrt(Math.max(0.01, radius * radius - (centre - ringY) ** 2));
  const steel = standard({ color: STEEL, roughness: 0.45, metalness: 0.6 });
  const cradle = mesh(new THREE.TorusGeometry(ringRadius, 0.26, 10, 34), steel, 0, ringY, 0);
  cradle.rotation.x = Math.PI / 2;
  g.add(cradle);
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    g.add(cyl(0.16, 0.2, ringY, steel, Math.cos(angle) * ringRadius, ringY / 2, Math.sin(angle) * ringRadius, 10));
  }

  return g;
}

// A DNA double helix. Two sugar-phosphate backbones and the base pairs between them,
// coloured four ways -- the four-letter alphabet is the whole idea.
export function dnaHelix({ height = 22, turns = 3.2, radius = 2.2 } = {}) {
  const parts = [];
  const baseColors = [0x4fa3d1, 0xe0b84f, 0x62b565, 0xd15f5f];
  const steps = 90;
  const base = 1.2;

  for (const phase of [0, Math.PI]) {
    const points = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const angle = t * Math.PI * 2 * turns + phase;
      points.push([Math.cos(angle) * radius, base + t * (height - base), Math.sin(angle) * radius]);
    }
    parts.push(tube(points, points.map(() => 0.3), 0xcfd8e0, { tubularSegments: 160, radialSegments: 8 }));
  }

  const rungs = Math.round(turns * 10);
  for (let i = 0; i <= rungs; i++) {
    const t = i / rungs;
    const angle = t * Math.PI * 2 * turns;
    const y = base + t * (height - base);
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const pairColor = baseColors[i % 2 === 0 ? i % 4 : (i + 2) % 4];

    for (const half of [1, -1]) {
      const rod = new THREE.CylinderGeometry(0.16, 0.16, radius, 8);
      rod.rotateZ(Math.PI / 2);
      const matrix = new THREE.Matrix4().makeRotationY(-angle);
      rod.applyMatrix4(matrix);
      parts.push({
        geometry: rod,
        position: [(x * half) / 2, y, (z * half) / 2],
        color: half > 0 ? pairColor : baseColors[(baseColors.indexOf(pairColor) + 1) % 4],
      });
    }
  }

  parts.push({
    geometry: new THREE.CylinderGeometry(radius * 1.5, radius * 1.65, 1.2, 30),
    position: [0, 0.6, 0],
    color: STEEL,
  });

  return group(mergedMesh(parts, { roughness: 0.5, metalness: 0.2 }));
}

// A single nerve cell stretched out to a length you can walk beside: dendrites gathering
// signals at one end, a myelinated axon carrying them, terminals handing them on. The
// gaps between the myelin segments are nodes of Ranvier, and they are why the signal
// jumps rather than crawls.
export function neuronModel({ length = 24 } = {}) {
  const g = group();
  const parts = [];
  const rng = seededRandom(31);
  const axonY = 7.2;

  const soma = new THREE.SphereGeometry(1.7, 22, 16);
  roughenSphere(soma, { amount: 0.16, phase: 2 });
  parts.push({ geometry: soma, position: [0, axonY, 0], color: 0xe0c48a });

  // Dendrites, each ending in a fork. Tapered to a single point instead, they came out
  // as straight needles and the cell body read as a sea urchin -- branching is the whole
  // job of a dendrite, and it is what makes the shape legible as one.
  for (let i = 0; i < 7; i++) {
    const angle = (i / 7) * Math.PI * 2;
    const reach = randomIn(rng, 2.6, 4.4);
    const lift = randomIn(rng, 0.4, 1.5);
    const tip = [Math.cos(angle) * reach - 2.4, axonY + lift, Math.sin(angle) * reach];
    parts.push(
      tube(
        [
          [0, axonY, 0],
          [Math.cos(angle) * reach * 0.5 - 1.2, axonY + lift * 0.6, Math.sin(angle) * reach * 0.5],
          tip,
        ],
        [0.36, 0.22, 0.13],
        NERVE_CREAM,
        { tubularSegments: 12, radialSegments: 6 }
      )
    );

    const dirX = Math.cos(angle);
    const dirZ = Math.sin(angle);
    for (const fork of [-1, 1]) {
      parts.push(
        tube(
          [
            tip,
            [tip[0] + dirX * 0.6 - dirZ * fork * 0.5, tip[1] + fork * 0.25, tip[2] + dirZ * 0.6 + dirX * fork * 0.5],
            [tip[0] + dirX * 1.1 - dirZ * fork * 1.1, tip[1] + fork * 0.6, tip[2] + dirZ * 1.1 + dirX * fork * 1.1],
          ],
          [0.13, 0.09, 0.05],
          NERVE_CREAM,
          { tubularSegments: 8, radialSegments: 5 }
        )
      );
    }
  }

  const axonEnd = length - 3.5;
  parts.push(
    tube(
      [[1.4, axonY, 0], [axonEnd * 0.35, axonY + 0.3, 0], [axonEnd * 0.7, axonY - 0.2, 0], [axonEnd, axonY, 0]],
      [0.34, 0.3, 0.3, 0.28],
      0xd9c48f,
      { tubularSegments: 40, radialSegments: 8 }
    )
  );

  const sheaths = 7;
  for (let i = 0; i < sheaths; i++) {
    const x = 3.0 + (i / sheaths) * (axonEnd - 4.2);
    const sheath = new THREE.CapsuleGeometry(0.62, (axonEnd - 4.2) / sheaths - 0.6, 6, 14);
    sheath.rotateZ(Math.PI / 2);
    parts.push({ geometry: sheath, position: [x, axonY, 0], color: 0xf2ead2 });
  }

  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2;
    const tipX = axonEnd + 2.6;
    const tipY = axonY + Math.cos(angle) * 1.9;
    const tipZ = Math.sin(angle) * 1.9;
    parts.push(
      tube(
        [[axonEnd, axonY, 0], [axonEnd + 1.4, axonY + Math.cos(angle) * 1.0, Math.sin(angle) * 1.0], [tipX, tipY, tipZ]],
        [0.24, 0.18, 0.14],
        NERVE_CREAM,
        { tubularSegments: 10, radialSegments: 6 }
      )
    );
    parts.push({ geometry: new THREE.SphereGeometry(0.42, 12, 10), position: [tipX, tipY, tipZ], color: 0xc8a35e });
  }

  for (const x of [0, axonEnd * 0.5, axonEnd + 1.6]) {
    standParts(parts, { top: axonY - 1.4, x, z: -1.4, plate: 1.3 });
  }

  g.add(mergedMesh(parts, { roughness: 0.62 }));
  return g;
}

// ---------------------------------------------------------------------------
// Walk-through structures
// ---------------------------------------------------------------------------

// A rib cage you walk up the inside of, spine along the top. Each rib pair is one
// tapered sweep along an ellipse rather than a torus arc: a real rib is thick where it
// meets the spine and thin where it reaches the sternum, and the taper is most of what
// makes a pile of curved bars read as a rib cage.
export function ribCageArch({ span = 15, height = 13, pairs = 7, spacing = 3.4 } = {}) {
  const parts = [];
  const a = span / 2;
  const b = height;
  const depth = (pairs - 1) * spacing;

  for (let i = 0; i < pairs; i++) {
    const z = -depth / 2 + i * spacing;
    // Lower ribs are shorter and angle down more steeply, as they do in a real cage.
    const shrink = 1 - Math.abs(i - (pairs - 1) * 0.45) * 0.045;
    const points = [];
    const radii = [];
    const segments = 14;
    for (let s = 0; s <= segments; s++) {
      const angle = Math.PI * (0.04 + (s / segments) * 0.92);
      const drop = Math.sin(angle) * 0 - Math.cos(angle) * 0;
      points.push([Math.cos(angle) * a * shrink, Math.sin(angle) * b * shrink + drop, z + Math.sin(angle) * 0.8]);
      const edge = Math.abs(s / segments - 0.5) * 2;
      radii.push(0.24 + edge * 0.22);
    }
    parts.push(tube(points, radii, BONE, { tubularSegments: 44, radialSegments: 8 }));

    // Vertebra + disc at the apex of each arc: the spine, seen from below, running the
    // length of the tunnel.
    parts.push({
      geometry: new THREE.BoxGeometry(1.5, 0.95, 1.7),
      position: [0, b * shrink + 0.5, z],
      color: 0xdad0b6,
    });
    parts.push({
      geometry: new THREE.BoxGeometry(0.5, 0.8, 1.2),
      position: [0, b * shrink + 1.3, z - 0.9],
      color: 0xcfc4a8,
    });
    if (i < pairs - 1) {
      parts.push({
        geometry: new THREE.BoxGeometry(1.3, 0.34, 1.5),
        position: [0, b * shrink + 0.5, z + spacing / 2],
        color: 0xc0b394,
      });
    }
  }

  return group(mergedMesh(parts, { roughness: 0.72 }));
}

function endotheliumTexture() {
  return canvasTexture(1024, 512, (ctx, w, h) => {
    ctx.fillStyle = '#8e2f2b';
    ctx.fillRect(0, 0, w, h);
    const rng = seededRandom(97);

    // Endothelial cells: long, flat, aligned with the flow. Drawn as soft ellipses so
    // they read as a living lining rather than as tiling -- painted rectangles on a
    // curved surface read as literal floating panels, which is the same trap the Mars
    // dust devil hit.
    for (let i = 0; i < 190; i++) {
      const x = rng() * w;
      const y = rng() * h;
      const rx = randomIn(rng, 26, 54);
      const ry = randomIn(rng, 9, 17);
      const shade = Math.floor(randomIn(rng, 150, 200));
      ctx.fillStyle = `rgba(${shade}, ${Math.floor(shade * 0.42)}, ${Math.floor(shade * 0.4)}, 0.5)`;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, randomIn(rng, -0.16, 0.16), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(70,18,18,0.45)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  });
}

// The tunnel a miniaturised visitor walks through to get into the exhibition: a length
// of artery, lit from inside.
//
// The axis sits BELOW the tube's radius on purpose, so the ground plane cuts the tube
// well below its centre line. That leaves a wide opening at ground level with the vessel
// arching overhead -- which is walkable, whereas a tube centred at head height would put
// its floor underground and its walls in the student's face. PlayerController walks on
// the terrain, never on props, so there is no floor to stand on inside it either way.
export function arteryTunnel({ length = 30, radius = 6.5 } = {}) {
  const g = group();
  const axisY = radius * 0.45;

  const wall = mesh(
    new THREE.CylinderGeometry(radius, radius, length, 40, 1, true),
    standard({
      map: endotheliumTexture(),
      roughness: 0.62,
      side: THREE.DoubleSide,
      emissive: new THREE.Color(0x37100f),
      emissiveIntensity: 0.5,
    }),
    0,
    axisY,
    0
  );
  wall.rotation.x = Math.PI / 2;
  wall.receiveShadow = false; // curved zero-thickness surface -- pure shadow-map acne
  g.add(wall);

  // Bands of smooth muscle around the outside, which is what lets an artery squeeze.
  const bands = [];
  const count = Math.max(3, Math.round(length / 6));
  for (let i = 0; i <= count; i++) {
    const z = -length / 2 + (i / count) * length;
    const ring = new THREE.TorusGeometry(radius + 0.18, 0.42, 8, 40);
    bands.push({ geometry: ring, position: [0, axisY, z], color: 0x6d221f });
  }
  const muscle = mergedMesh(bands, { roughness: 0.8 });
  muscle.receiveShadow = false;
  g.add(muscle);

  return g;
}

// ---------------------------------------------------------------------------
// The micro-sub
// ---------------------------------------------------------------------------

// The world's premise, parked at the entrance: a 1966 film imagined a submarine and its
// crew shrunk small enough to be injected into a patient. The placard beside it in the
// layout is where the real version of the idea lives -- swallowable pill cameras, which
// have been in hospital use since 2001.
export function microSub({ length = 12 } = {}) {
  const g = group();
  const hullY = 3.4;
  const parts = [];

  const hull = new THREE.CapsuleGeometry(1.7, length - 4.4, 10, 22);
  hull.rotateX(Math.PI / 2);
  parts.push({ geometry: hull, position: [0, hullY, 0], color: 0xd8dde2 });

  const trim = 0x3f8ba3;
  parts.push({
    geometry: new THREE.CylinderGeometry(1.85, 1.85, 0.5, 26),
    rotation: [Math.PI / 2, 0, 0],
    position: [0, hullY, -0.4],
    color: trim,
  });

  // The conning tower. Without it the hull is an egg on a stand -- a sail on top is the
  // one feature that says "submarine" from any angle, including nose-on.
  parts.push({ geometry: new THREE.BoxGeometry(1.3, 1.8, 3.0), position: [0, hullY + 1.5, 0.6], color: trim });
  parts.push({ geometry: new THREE.CylinderGeometry(0.08, 0.08, 1.8, 8), position: [0, hullY + 3.2, -0.3], color: 0x9aa4ad });

  for (const [rz, px, py] of [
    [0, 0, hullY + 1.9],
    [Math.PI / 2, 1.9, hullY],
    [Math.PI / 2, -1.9, hullY],
  ]) {
    parts.push({
      geometry: new THREE.BoxGeometry(0.3, 1.7, 2.6),
      rotation: [0, 0, rz],
      position: [px, py, -length * 0.3],
      color: trim,
    });
  }

  // Portholes down both flanks. Without them the hull is a smooth grey pod with no scale
  // and no way to tell which way up it goes -- a row of windows is what makes it read as
  // a crewed vessel at a glance.
  for (const side of [-1, 1]) {
    for (const z of [2.0, 0.4, -1.2]) {
      const ring = new THREE.TorusGeometry(0.34, 0.09, 8, 16);
      ring.rotateY((side * Math.PI) / 2);
      parts.push({ geometry: ring, position: [side * 1.62, hullY + 0.3, z], color: trim });
      const glass = new THREE.CylinderGeometry(0.3, 0.3, 0.08, 14);
      glass.rotateZ(Math.PI / 2);
      parts.push({ geometry: glass, position: [side * 1.62, hullY + 0.3, z], color: 0xbfe4f2 });
    }
  }

  // Ducted thruster. Kept slim and pale on purpose: at the first size and colour tried,
  // a fat near-black ring read as a tyre bolted to the back of the sub and dominated the
  // whole silhouette.
  const shroud = new THREE.TorusGeometry(1.15, 0.2, 8, 26);
  parts.push({ geometry: shroud, position: [0, hullY, -length / 2 + 0.4], color: 0x8c96a1 });
  for (let i = 0; i < 4; i++) {
    const blade = new THREE.BoxGeometry(2.0, 0.13, 0.42);
    blade.rotateZ((i / 4) * Math.PI * 2);
    blade.rotateX(0.4);
    parts.push({ geometry: blade, position: [0, hullY, -length / 2 + 0.4], color: 0xb9c2ca });
  }

  // Cradle: two A-frames, so the sub reads as parked and serviced rather than as a
  // vehicle that happens to be hovering.
  for (const z of [-length * 0.26, length * 0.26]) {
    for (const side of [-1, 1]) {
      parts.push({
        geometry: new THREE.CylinderGeometry(0.16, 0.2, hullY + 0.4, 10),
        rotation: [0, 0, side * 0.28],
        position: [side * (hullY * 0.22), (hullY + 0.4) / 2, z],
        color: STEEL,
      });
    }
    parts.push({
      geometry: new THREE.BoxGeometry(4.4, 0.3, 0.9),
      position: [0, 0.15, z],
      color: STEEL,
    });
  }

  g.add(mergedMesh(parts, { roughness: 0.45, metalness: 0.55 }));

  // Canopy: a bubble on the FRONT of the sail, where it clears the hull. Sunk into the
  // hull line -- which is where it started -- a canopy the width of the hull is simply
  // inside it and renders as nothing at all.
  const canopy = mesh(
    new THREE.SphereGeometry(1.25, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.66),
    standard({
      color: 0x9fd8e6,
      transparent: true,
      opacity: 0.55,
      roughness: 0.12,
      side: THREE.DoubleSide,
      emissive: new THREE.Color(0x2b6577),
      emissiveIntensity: 0.7,
    }),
    0,
    hullY + 1.25,
    2.5
  );
  canopy.castShadow = false;
  g.add(canopy);

  // Navigation lights, low and forward on the flanks -- port red, starboard green, the
  // real convention. At the size and height first tried they read as ears.
  for (const side of [-1, 1]) {
    const lamp = mesh(
      new THREE.SphereGeometry(0.24, 12, 10),
      standard({
        color: 0xfff6da,
        emissive: new THREE.Color(side > 0 ? 0x62e0a0 : 0xe06262),
        emissiveIntensity: 2.4,
        roughness: 0.4,
      }),
      side * 1.0,
      hullY - 0.75,
      length / 2 - 1.7
    );
    lamp.userData.isGlowMesh = true;
    g.add(lamp);
  }

  // On both flanks, and emissive: one flank always faces away from the sun, and a flat
  // unlit panel renders as a black slab rather than as a dark one.
  const nameTexture = canvasTexture(640, 108, (ctx, w, h) => {
    ctx.fillStyle = '#e7ebee';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1e4a58';
    ctx.textAlign = 'center';
    ctx.font = 'bold 54px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('MICRO-SUB  MV-1', w / 2, 74);
  });
  for (const side of [-1, 1]) {
    const name = signPanel(3.6, 0.6, nameTexture, { emissive: '#5a6a74' });
    name.position.set(side * 1.74, hullY + 1.25, -0.4);
    name.rotation.y = (side * Math.PI) / 2;
    g.add(name);
  }

  return g;
}

// ---------------------------------------------------------------------------
// The anatomy charts -- where whole SYSTEMS are taught
// ---------------------------------------------------------------------------

const CHART_W = 768;
const CHART_H = 1024;

// The silhouette every system chart is drawn onto, in its own coordinate space: origin
// at the centre of the head-top, 840 units tall, +x to the viewer's right. Callers work
// in that space via withBody(), so an organ drawn at (-40, 430) lands in the same place
// on every chart it appears on.
function bodyOutline(ctx, { fill = '#efdfd5', stroke = '#b1907f' } = {}) {
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 3;

  ctx.beginPath();
  ctx.ellipse(0, 78, 60, 76, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-28, 138);
  ctx.lineTo(-30, 176);
  ctx.quadraticCurveTo(-118, 194, -132, 250);
  ctx.lineTo(-174, 470);
  ctx.lineTo(-192, 640);
  ctx.lineTo(-156, 648);
  ctx.lineTo(-134, 474);
  ctx.lineTo(-108, 302);
  ctx.quadraticCurveTo(-102, 400, -96, 468);
  ctx.quadraticCurveTo(-118, 520, -110, 582);
  ctx.lineTo(-94, 830);
  ctx.lineTo(-30, 830);
  ctx.lineTo(-22, 600);
  ctx.lineTo(0, 556);
  ctx.lineTo(22, 600);
  ctx.lineTo(30, 830);
  ctx.lineTo(94, 830);
  ctx.lineTo(110, 582);
  ctx.quadraticCurveTo(118, 520, 96, 468);
  ctx.quadraticCurveTo(102, 400, 108, 302);
  ctx.lineTo(134, 474);
  ctx.lineTo(156, 648);
  ctx.lineTo(192, 640);
  ctx.lineTo(174, 470);
  ctx.lineTo(132, 250);
  ctx.quadraticCurveTo(118, 194, 30, 176);
  ctx.lineTo(28, 138);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

// Runs `draw` inside the silhouette's coordinate space and hands back a mapper so the
// caller can put a label leader on a canvas-space point that lines up with a body-space
// one.
function withBody(ctx, cx, top, height, draw) {
  const s = height / 840;
  ctx.save();
  ctx.translate(cx, top);
  ctx.scale(s, s);
  draw(ctx);
  ctx.restore();
  return (bx, by) => [cx + bx * s, top + by * s];
}

function fillPath(ctx, fill, stroke, build) {
  ctx.beginPath();
  build(ctx);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
}

// --- Organ shapes, all in body space ---------------------------------------

function shapeLungs(ctx) {
  ctx.strokeStyle = '#bfae83';
  ctx.lineCap = 'round';
  ctx.lineWidth = 13;
  ctx.beginPath();
  ctx.moveTo(0, 186);
  ctx.lineTo(0, 262);
  ctx.stroke();
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(0, 262);
  ctx.lineTo(-34, 296);
  ctx.moveTo(0, 262);
  ctx.lineTo(34, 296);
  ctx.stroke();

  for (const side of [-1, 1]) {
    fillPath(ctx, '#e0989c', '#a3666a', (c) => {
      c.moveTo(side * 14, 258);
      c.bezierCurveTo(side * 66, 252, side * 84, 320, side * 74, 386);
      c.bezierCurveTo(side * 66, 428, side * 34, 424, side * 20, 388);
      c.bezierCurveTo(side * 14, 340, side * 14, 300, side * 14, 258);
      c.closePath();
    });
    // Fissures: three lobes on the body's right (-x), two on the left.
    ctx.strokeStyle = '#a3666a';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(side * 18, 316);
    ctx.lineTo(side * 78, 342);
    if (side < 0) {
      ctx.moveTo(side * 22, 356);
      ctx.lineTo(side * 74, 350);
    }
    ctx.stroke();
  }
}

function shapeHeart(ctx) {
  fillPath(ctx, '#b8362f', '#7d211c', (c) => {
    c.moveTo(6, 300);
    c.bezierCurveTo(38, 288, 56, 322, 44, 352);
    c.bezierCurveTo(36, 374, 18, 392, 4, 404);
    c.bezierCurveTo(-12, 388, -28, 366, -30, 342);
    c.bezierCurveTo(-32, 314, -14, 290, 6, 300);
    c.closePath();
  });
  ctx.strokeStyle = '#7d211c';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(2, 300);
  ctx.quadraticCurveTo(-6, 268, -26, 268);
  ctx.stroke();
}

function shapeLiver(ctx) {
  fillPath(ctx, '#8e4034', '#5f2820', (c) => {
    c.moveTo(-104, 408);
    c.quadraticCurveTo(-30, 396, 30, 412);
    c.quadraticCurveTo(46, 432, 22, 452);
    c.quadraticCurveTo(-40, 474, -96, 454);
    c.quadraticCurveTo(-110, 434, -104, 408);
    c.closePath();
  });
  fillPath(ctx, '#6e8a45', '#4a5f2c', (c) => {
    c.ellipse(-40, 458, 14, 9, 0.1, 0, Math.PI * 2);
  });
}

function shapeStomach(ctx) {
  fillPath(ctx, '#d4837a', '#9a5750', (c) => {
    c.moveTo(20, 400);
    c.bezierCurveTo(74, 396, 96, 440, 82, 476);
    c.bezierCurveTo(70, 506, 30, 512, 14, 492);
    c.bezierCurveTo(26, 486, 46, 480, 52, 462);
    c.bezierCurveTo(60, 436, 44, 416, 20, 400);
    c.closePath();
  });
  ctx.strokeStyle = '#9a5750';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(22, 400);
  ctx.quadraticCurveTo(14, 350, 8, 300);
  ctx.stroke();
}

function shapeIntestines(ctx) {
  ctx.strokeStyle = '#a7603f';
  ctx.lineWidth = 17;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-62, 570);
  ctx.lineTo(-62, 500);
  ctx.quadraticCurveTo(-62, 486, -46, 486);
  ctx.lineTo(46, 486);
  ctx.quadraticCurveTo(62, 486, 62, 502);
  ctx.lineTo(62, 566);
  ctx.stroke();

  // The small intestine, serpentined inside the colon's frame. The row count and the
  // vertical span are both fixed on purpose: driven by a per-loop increment instead, the
  // coil ran off the bottom of the abdomen and down between the figure's legs.
  ctx.strokeStyle = '#d0836f';
  ctx.lineWidth = 11;
  ctx.beginPath();
  const top = 500;
  const rows = 4;
  const step = 14;
  let x = -36;
  ctx.moveTo(x, top);
  for (let i = 0; i < rows; i++) {
    const y0 = top + i * step;
    const y1 = y0 + step;
    const nx = -x;
    ctx.bezierCurveTo(x * 1.8, y0 + step * 0.4, nx * 1.8, y1 - step * 0.4, nx, y1);
    x = nx;
  }
  ctx.stroke();
}

function shapeKidneys(ctx) {
  for (const side of [-1, 1]) {
    const y = side < 0 ? 446 : 434;
    fillPath(ctx, '#9d4a3b', '#68291f', (c) => {
      c.moveTo(side * 46, y - 26);
      c.bezierCurveTo(side * 74, y - 22, side * 74, y + 22, side * 46, y + 26);
      c.bezierCurveTo(side * 56, y + 12, side * 56, y - 12, side * 46, y - 26);
      c.closePath();
    });
    ctx.strokeStyle = '#e0cfa4';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(side * 50, y + 16);
    ctx.quadraticCurveTo(side * 40, y + 60, side * 18, 552);
    ctx.stroke();
  }
  fillPath(ctx, '#d8c98a', '#9b8b4b', (c) => {
    c.ellipse(0, 566, 26, 20, 0, 0, Math.PI * 2);
  });
}

function shapeBrain(ctx) {
  fillPath(ctx, '#d7a9a2', '#9c7069', (c) => {
    c.ellipse(0, 62, 46, 44, 0, 0, Math.PI * 2);
  });
  ctx.strokeStyle = '#9c7069';
  ctx.lineWidth = 3;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.moveTo(-42, 40 + i * 11);
    ctx.bezierCurveTo(-16, 30 + i * 11, 16, 52 + i * 11, 42, 40 + i * 11);
    ctx.stroke();
  }
  fillPath(ctx, '#be8a80', '#8f5f57', (c) => {
    c.ellipse(0, 116, 26, 15, 0, 0, Math.PI * 2);
  });
}

// --- Chart drawers ---------------------------------------------------------

function chartFrame(ctx, title, caption) {
  ctx.fillStyle = CHART_PAPER;
  ctx.fillRect(0, 0, CHART_W, CHART_H);
  ctx.fillStyle = CHART_TEAL;
  ctx.fillRect(18, 18, CHART_W - 36, 96);
  ctx.strokeStyle = CHART_TEAL;
  ctx.lineWidth = 10;
  ctx.strokeRect(18, 18, CHART_W - 36, CHART_H - 36);

  ctx.textAlign = 'center';
  ctx.fillStyle = CHART_PAPER;
  ctx.font = 'bold 52px Georgia, "Times New Roman", serif';
  ctx.fillText(String(title).toUpperCase(), CHART_W / 2, 84);

  // The caption block starts high enough for six wrapped lines to land inside the frame.
  // Set to a comfortable-looking 25px starting near the bottom, every caption longer
  // than about three lines simply ran off the panel and the last sentence was lost.
  if (caption) {
    ctx.textAlign = 'left';
    ctx.fillStyle = CHART_INK;
    ctx.font = '22px Georgia, "Times New Roman", serif';
    wrapText(ctx, caption, 54, 858, CHART_W - 108, 28);
  }
  ctx.textAlign = 'left';
}

function leader(ctx, from, to, text, align = 'left') {
  ctx.strokeStyle = CHART_INK;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(from[0], from[1]);
  ctx.lineTo(to[0], to[1]);
  ctx.stroke();
  ctx.fillStyle = CHART_INK;
  ctx.beginPath();
  ctx.arc(from[0], from[1], 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.textAlign = align;
  ctx.font = 'bold 23px "Helvetica Neue", Arial, sans-serif';
  ctx.fillText(text, to[0] + (align === 'left' ? 10 : -10), to[1] + 8);
}

const CHART_DRAWERS = {
  // The whole-body map: this is the chart the world is built around, and the one that
  // answers "where is the thing I just walked around, and what is it next to?"
  'body-systems': (ctx) => {
    chartFrame(
      ctx,
      'The organ systems',
      'Ten or so systems share one body, and they overlap: the same blood the heart pumps is cleaned by the kidneys, loaded with oxygen by the lungs and fed by the gut. Left and right on this chart are the BODY’S left and right — so its right lung is on your left.'
    );
    const map = withBody(ctx, 300, 150, 700, (c) => {
      bodyOutline(c);
      shapeBrain(c);
      shapeLungs(c);
      shapeHeart(c);
      shapeLiver(c);
      shapeStomach(c);
      shapeKidneys(c);
      shapeIntestines(c);
    });

    leader(ctx, map(0, 62), [560, 210], 'Brain');
    leader(ctx, map(-60, 320), [110, 300], 'Lungs', 'right');
    leader(ctx, map(20, 340), [560, 330], 'Heart');
    leader(ctx, map(-70, 430), [110, 430], 'Liver', 'right');
    leader(ctx, map(60, 452), [560, 430], 'Stomach');
    leader(ctx, map(56, 434), [560, 500], 'Kidneys');
    leader(ctx, map(0, 530), [560, 580], 'Intestines');
    leader(ctx, map(0, 566), [560, 650], 'Bladder');
  },

  respiratory: (ctx) => {
    chartFrame(
      ctx,
      'Respiratory system',
      'Air travels nose → trachea → bronchi → bronchioles → alveoli. Only in the alveoli does anything actually cross into the blood. You do this about 20,000 times a day without deciding to.'
    );
    const map = withBody(ctx, 320, 170, 660, (c) => {
      bodyOutline(c, { fill: '#f1e6de', stroke: '#c0a595' });
      shapeLungs(c);
    });
    leader(ctx, map(0, 210), [590, 250], 'Trachea (windpipe)');
    leader(ctx, map(-30, 292), [130, 330], 'Bronchi', 'right');
    leader(ctx, map(-60, 300), [590, 330], 'Right lung — 3 lobes');
    leader(ctx, map(60, 300), [590, 400], 'Left lung — 2 lobes');
    leader(ctx, map(0, 420), [590, 470], 'Diaphragm pulls down');
  },

  circulatory: (ctx) => {
    chartFrame(
      ctx,
      'Circulatory system',
      'One pump, two circuits: the right side of the heart sends blood to the lungs for oxygen, the left side sends it to everything else. End to end, one person’s blood vessels would run about 60,000 miles — twice around the Earth.'
    );
    const map = withBody(ctx, 320, 170, 660, (c) => {
      bodyOutline(c, { fill: '#f1e6de', stroke: '#c0a595' });
      c.lineCap = 'round';
      // Arteries out, veins back.
      c.strokeStyle = '#c0392b';
      c.lineWidth = 7;
      c.beginPath();
      c.moveTo(-8, 320);
      c.quadraticCurveTo(-16, 200, -12, 120);
      c.moveTo(-8, 330);
      c.quadraticCurveTo(-70, 340, -140, 420);
      c.moveTo(8, 330);
      c.quadraticCurveTo(70, 340, 140, 420);
      c.moveTo(0, 380);
      c.quadraticCurveTo(-6, 520, -50, 700);
      c.moveTo(4, 380);
      c.quadraticCurveTo(10, 520, 52, 700);
      c.stroke();
      c.strokeStyle = '#40598f';
      c.lineWidth = 6;
      c.beginPath();
      c.moveTo(16, 320);
      c.quadraticCurveTo(24, 200, 18, 124);
      c.moveTo(-18, 340);
      c.quadraticCurveTo(-80, 356, -150, 430);
      c.moveTo(18, 340);
      c.quadraticCurveTo(80, 356, 150, 430);
      c.moveTo(-14, 390);
      c.quadraticCurveTo(-20, 524, -62, 700);
      c.moveTo(18, 390);
      c.quadraticCurveTo(26, 524, 64, 700);
      c.stroke();
      shapeLungs(c);
      shapeHeart(c);
    });
    leader(ctx, map(8, 348), [600, 300], 'Heart');
    leader(ctx, map(-60, 320), [140, 300], 'Lungs', 'right');
    leader(ctx, map(-70, 500), [140, 520], 'Arteries (red)', 'right');
    leader(ctx, map(70, 520), [600, 540], 'Veins (blue)');
  },

  digestive: (ctx) => {
    chartFrame(
      ctx,
      'Digestive system',
      'A single tube about 30 feet long, from mouth to end. The stomach mostly churns and acidifies; nearly all the ABSORBING happens further down, in the small intestine, through millions of tiny finger-shaped villi.'
    );
    const map = withBody(ctx, 320, 170, 660, (c) => {
      bodyOutline(c, { fill: '#f1e6de', stroke: '#c0a595' });
      shapeIntestines(c);
      shapeLiver(c);
      shapeStomach(c);
    });
    leader(ctx, map(10, 300), [600, 280], 'Oesophagus');
    leader(ctx, map(56, 452), [600, 360], 'Stomach');
    leader(ctx, map(-80, 430), [130, 400], 'Liver', 'right');
    leader(ctx, map(-40, 458), [130, 470], 'Gall bladder', 'right');
    leader(ctx, map(0, 540), [600, 470], 'Small intestine');
    leader(ctx, map(-62, 520), [130, 560], 'Large intestine', 'right');
  },

  urinary: (ctx) => {
    chartFrame(
      ctx,
      'Urinary system',
      'The kidneys filter roughly 180 litres of fluid out of your blood every day — and put about 99% of it straight back. What is left, around 1.5 litres, runs down the ureters to the bladder.'
    );
    const map = withBody(ctx, 320, 170, 660, (c) => {
      bodyOutline(c, { fill: '#f1e6de', stroke: '#c0a595' });
      shapeKidneys(c);
    });
    leader(ctx, map(-58, 446), [130, 400], 'Right kidney (sits lower)', 'right');
    leader(ctx, map(58, 434), [600, 380], 'Left kidney');
    leader(ctx, map(34, 500), [600, 470], 'Ureter');
    leader(ctx, map(0, 566), [600, 560], 'Bladder');
  },

  nervous: (ctx) => {
    chartFrame(
      ctx,
      'Nervous system',
      'The brain is about 2% of your body weight and uses about 20% of your oxygen. Signals travel along nerves at up to 120 metres per second — roughly 270 miles per hour.'
    );
    const map = withBody(ctx, 320, 170, 660, (c) => {
      bodyOutline(c, { fill: '#f1e6de', stroke: '#c0a595' });
      c.strokeStyle = '#c9a227';
      c.lineWidth = 7;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(0, 130);
      c.lineTo(0, 470);
      c.stroke();
      c.lineWidth = 4;
      c.beginPath();
      for (let i = 0; i < 9; i++) {
        const y = 200 + i * 30;
        c.moveTo(0, y);
        c.quadraticCurveTo(-60, y + 10, -120, y + 60);
        c.moveTo(0, y);
        c.quadraticCurveTo(60, y + 10, 120, y + 60);
      }
      c.moveTo(0, 470);
      c.quadraticCurveTo(-24, 600, -60, 800);
      c.moveTo(0, 470);
      c.quadraticCurveTo(24, 600, 60, 800);
      c.stroke();
      shapeBrain(c);
    });
    leader(ctx, map(0, 62), [600, 230], 'Brain');
    leader(ctx, map(0, 116), [130, 300], 'Cerebellum', 'right');
    leader(ctx, map(0, 380), [600, 420], 'Spinal cord');
    leader(ctx, map(80, 560), [600, 560], 'Nerves');
  },

  skeletal: (ctx) => {
    chartFrame(
      ctx,
      'Skeletal system',
      'An adult has 206 bones; a newborn has around 300, and some of them fuse together as you grow. Bone is living tissue — it is being broken down and rebuilt inside you right now.'
    );
    const map = withBody(ctx, 320, 170, 660, (c) => {
      bodyOutline(c, { fill: '#f1e6de', stroke: '#c0a595' });
      c.fillStyle = '#e4dbc4';
      c.strokeStyle = '#9a8f74';
      c.lineWidth = 3;

      // Skull, jaw, spine, ribs, pelvis, limb bones.
      c.beginPath();
      c.ellipse(0, 74, 46, 54, 0, 0, Math.PI * 2);
      c.fill();
      c.stroke();

      for (let i = 0; i < 14; i++) {
        c.beginPath();
        c.rect(-11, 180 + i * 26, 22, 18);
        c.fill();
        c.stroke();
      }

      for (let i = 0; i < 7; i++) {
        const y = 236 + i * 30;
        for (const side of [-1, 1]) {
          c.beginPath();
          c.moveTo(side * 8, y);
          c.quadraticCurveTo(side * (86 + i * 3), y + 12, side * 30, y + 76);
          c.lineWidth = 7;
          c.strokeStyle = '#d7cdb2';
          c.stroke();
        }
      }
      c.lineWidth = 3;
      c.strokeStyle = '#9a8f74';

      c.beginPath();
      c.moveTo(-72, 540);
      c.quadraticCurveTo(0, 512, 72, 540);
      c.quadraticCurveTo(60, 610, 20, 600);
      c.quadraticCurveTo(0, 570, -20, 600);
      c.quadraticCurveTo(-60, 610, -72, 540);
      c.closePath();
      c.fill();
      c.stroke();

      for (const side of [-1, 1]) {
        c.lineWidth = 15;
        c.strokeStyle = '#e4dbc4';
        c.lineCap = 'round';
        c.beginPath();
        c.moveTo(side * 116, 250);
        c.lineTo(side * 152, 460);
        c.moveTo(side * 152, 470);
        c.lineTo(side * 176, 626);
        c.moveTo(side * 46, 590);
        c.lineTo(side * 60, 720);
        c.moveTo(side * 60, 732);
        c.lineTo(side * 62, 820);
        c.stroke();
      }
      c.lineWidth = 3;
    });
    leader(ctx, map(0, 74), [600, 230], 'Skull');
    leader(ctx, map(0, 330), [130, 330], 'Spine — 33 vertebrae', 'right');
    leader(ctx, map(60, 300), [600, 330], 'Rib cage — 12 pairs');
    leader(ctx, map(0, 545), [600, 520], 'Pelvis');
    leader(ctx, map(60, 700), [600, 660], 'Femur — longest bone');
  },

  cell: (ctx) => {
    chartFrame(
      ctx,
      'The animal cell',
      'You are built from roughly 37 trillion of these. Every one carries the same instruction book — about two metres of DNA, coiled up inside a nucleus a hundredth of a millimetre across.'
    );
    const cx = 330;
    const cy = 480;
    const r = 250;

    ctx.beginPath();
    ctx.ellipse(cx, cy, r, r * 0.86, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#dceff4';
    ctx.fill();
    ctx.strokeStyle = '#2f5d6b';
    ctx.lineWidth = 7;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx - 30, cy - 20, 86, 0, Math.PI * 2);
    ctx.fillStyle = '#b9a3d6';
    ctx.fill();
    ctx.strokeStyle = '#6b4f96';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx - 46, cy - 34, 30, 0, Math.PI * 2);
    ctx.fillStyle = '#7f5fae';
    ctx.fill();

    const rng = seededRandom(41);
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2 + 0.5;
      const x = cx + Math.cos(angle) * r * 0.62;
      const y = cy + Math.sin(angle) * r * 0.54;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(randomIn(rng, -1, 1));
      ctx.beginPath();
      ctx.ellipse(0, 0, 44, 19, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#d88a3c';
      ctx.fill();
      ctx.strokeStyle = '#96591f';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.beginPath();
      for (let k = -3; k <= 3; k++) {
        ctx.moveTo(k * 11, -14);
        ctx.quadraticCurveTo(k * 11 + 8, 0, k * 11, 14);
      }
      ctx.stroke();
      ctx.restore();
    }

    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.ellipse(cx + 150, cy + 110 + i * 20, 62 - i * 6, 12, 0.12, 0, Math.PI);
      ctx.strokeStyle = '#46a08c';
      ctx.lineWidth = 9;
      ctx.stroke();
    }

    leader(ctx, [cx - 30, cy - 20], [600, 300], 'Nucleus');
    leader(ctx, [cx + 110, cy - 130], [600, 370], 'Mitochondria');
    leader(ctx, [cx + 150, cy + 130], [600, 640], 'Golgi apparatus');
    leader(ctx, [cx - r + 20, cy + 90], [110, 700], 'Cell membrane', 'right');
  },

  'kidney-section': (ctx) => {
    chartFrame(
      ctx,
      'Inside a kidney',
      'Each kidney holds about a million nephrons — microscopic filters. Blood arrives under pressure, water and waste are squeezed out in the cortex, and what the body still needs is reabsorbed on the way back through.'
    );
    const cx = 320;
    const cy = 470;

    ctx.beginPath();
    ctx.moveTo(cx + 96, cy - 210);
    ctx.bezierCurveTo(cx + 250, cy - 180, cx + 250, cy + 180, cx + 96, cy + 210);
    ctx.bezierCurveTo(cx + 150, cy + 90, cx + 150, cy - 90, cx + 96, cy - 210);
    ctx.closePath();
    ctx.fillStyle = '#c4675a';
    ctx.fill();
    ctx.strokeStyle = '#68291f';
    ctx.lineWidth = 5;
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx + 96, cy - 210);
    ctx.bezierCurveTo(cx + 250, cy - 180, cx + 250, cy + 180, cx + 96, cy + 210);
    ctx.bezierCurveTo(cx + 150, cy + 90, cx + 150, cy - 90, cx + 96, cy - 210);
    ctx.closePath();
    ctx.clip();

    // Medulla pyramids, pointing in toward the pelvis.
    for (let i = 0; i < 5; i++) {
      const angle = -1.0 + i * 0.5;
      ctx.beginPath();
      ctx.moveTo(cx + 118, cy + Math.sin(angle) * 150);
      ctx.lineTo(cx + 232, cy + Math.sin(angle) * 190 - 46);
      ctx.lineTo(cx + 232, cy + Math.sin(angle) * 190 + 46);
      ctx.closePath();
      ctx.fillStyle = '#9d4a3b';
      ctx.fill();
      ctx.strokeStyle = '#6d2b20';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    ctx.restore();

    // Renal pelvis and the ureter leaving it.
    ctx.beginPath();
    ctx.moveTo(cx + 116, cy - 90);
    ctx.quadraticCurveTo(cx + 60, cy, cx + 116, cy + 90);
    ctx.quadraticCurveTo(cx + 140, cy, cx + 116, cy - 90);
    ctx.closePath();
    ctx.fillStyle = '#e6d7ab';
    ctx.fill();
    ctx.strokeStyle = '#9b8b4b';
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.strokeStyle = '#e6d7ab';
    ctx.lineWidth = 20;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx + 100, cy + 40);
    ctx.quadraticCurveTo(cx + 30, cy + 130, cx + 40, cy + 250);
    ctx.stroke();

    ctx.strokeStyle = '#c0392b';
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.moveTo(cx + 108, cy - 40);
    ctx.lineTo(cx - 10, cy - 70);
    ctx.stroke();
    ctx.strokeStyle = '#40598f';
    ctx.lineWidth = 18;
    ctx.beginPath();
    ctx.moveTo(cx + 110, cy);
    ctx.lineTo(cx - 10, cy + 20);
    ctx.stroke();

    leader(ctx, [cx + 236, cy - 150], [612, 260], 'Cortex — filtering happens here');
    leader(ctx, [cx + 200, cy + 40], [612, 420], 'Medulla pyramids');
    leader(ctx, [cx + 116, cy], [612, 520], 'Renal pelvis');
    leader(ctx, [cx - 10, cy - 70], [120, 300], 'Renal artery in', 'right');
    leader(ctx, [cx - 10, cy + 20], [120, 380], 'Renal vein out', 'right');
    leader(ctx, [cx + 40, cy + 230], [120, 700], 'Ureter to bladder', 'right');
  },
};

// A large standing diagram on two posts. This is the world's "image" half: a system is a
// set of relationships, and a labelled drawing carries relationships that no amount of
// walking around a 3D organ can.
export function anatomyChart({ chart = 'body-systems', width = 9, postHeight = 3 } = {}) {
  const draw = CHART_DRAWERS[chart] || CHART_DRAWERS['body-systems'];
  const height = (width * CHART_H) / CHART_W;
  const g = group();
  const frameMaterial = standard({ color: 0x2b3a42, roughness: 0.5, metalness: 0.4 });

  const inset = width / 2 - 0.35;
  g.add(cyl(0.17, 0.22, postHeight, frameMaterial, -inset, postHeight / 2, 0, 12));
  g.add(cyl(0.17, 0.22, postHeight, frameMaterial, inset, postHeight / 2, 0, 12));
  g.add(box(width * 0.7, 0.24, 1.4, frameMaterial, -inset, 0.12, 0));
  g.add(box(width * 0.7, 0.24, 1.4, frameMaterial, inset, 0.12, 0));

  const panelY = postHeight + height / 2;
  g.add(box(width + 0.3, height + 0.3, 0.14, frameMaterial, 0, panelY, -0.05));

  const face = signPanel(width, height, canvasTexture(CHART_W, CHART_H, (ctx) => draw(ctx)));
  face.position.set(0, panelY, 0.03);
  g.add(face);

  return g;
}
