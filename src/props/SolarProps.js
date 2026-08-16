import * as THREE from 'three';
import {
  standard,
  mesh,
  box,
  cyl,
  sphere,
  group,
  mergeColored,
  mergedMesh,
  relief,
  canvasTexture,
  signPanel,
  seededRandom,
  randomIn,
  roughenSphere,
} from '../PropKit.js';

// The Solar System Walkthrough -- the Sun at one end of a walkway and the eight planets
// laid out along it, each with its own moons.
//
// THE TWO SCALES PROBLEM, which is the whole design of this world. A solar system model
// cannot use one scale for both size and distance. At a scale where Jupiter is big enough
// to walk around, Neptune is forty miles away; at a scale where all eight fit in a 390ft
// world, Earth is a grain of sand. Every science museum in the world solves this the same
// way and so does this: SIZE and DISTANCE get separate scales, and the walkway is marked
// with the real distances so the student can see what has been done to them.
//
// So: planets are sized against each other faithfully (Jupiter really is 11 Earths wide
// here) and spaced by a compressed, roughly logarithmic walk. Every placard states the
// real diameter and the real distance, the same contract Ancient Egypt and Fantastic
// Voyage use.
//
// House rules: feet at scale 1, origin at base centre, fresh materials per call,
// seededRandom never Math.random. See PropKit.js.

// Earth = 1.6ft radius. Everything else is that times its true ratio to Earth.
const E = 1.6;

// ---------------------------------------------------------------------------
// Planet surfaces
// ---------------------------------------------------------------------------

// A planet's colour map. These are drawn, not photographed, and each one is built from
// the ONE feature that actually identifies the planet -- which is a better lesson than a
// blurry photo would be, and is the same reasoning the museum's paintings use.
//
// Every map is 512x256 (2:1), because that is the aspect a sphere's default UV wants: the
// u axis wraps 360 degrees of longitude and v covers 180 of latitude. A square texture
// stretches everything vertically.
function planetTexture(kind, seed = 1) {
  return canvasTexture(512, 256, (ctx, w, h) => {
    const rng = seededRandom(seed);

    // A horizontal band, drawn as a soft-edged strip. Gas giants are ALL bands, and the
    // reason they read as gas rather than paint is that the edges are diffuse and the
    // bands vary in width.
    const band = (y0, y1, color, alpha = 1) => {
      const g = ctx.createLinearGradient(0, y0, 0, y1);
      g.addColorStop(0, `rgba(${color}, 0)`);
      g.addColorStop(0.25, `rgba(${color}, ${alpha})`);
      g.addColorStop(0.75, `rgba(${color}, ${alpha})`);
      g.addColorStop(1, `rgba(${color}, 0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, y0, w, y1 - y0);
    };

    // Craters, for the rocky airless bodies. A crater is a bright rim, a darker floor and
    // an offset shadow -- draw it as a flat dark disc and it reads as a hole punched in
    // paper.
    const crater = (x, y, r) => {
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath(); ctx.arc(x, y, r * 0.78, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.beginPath(); ctx.arc(x - r * 0.16, y - r * 0.16, r * 0.55, 0, Math.PI * 2); ctx.fill();
    };

    // Irregular blob, for continents and storm systems.
    const blob = (x, y, r, color, wobble = 0.45) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      const steps = 18;
      for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const rr = r * (1 - wobble / 2 + rng() * wobble);
        const px = x + Math.cos(a) * rr * 1.5;
        const py = y + Math.sin(a) * rr;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    };

    if (kind === 'sun') {
      ctx.fillStyle = '#ffb733';
      ctx.fillRect(0, 0, w, h);
      // Granulation: the Sun's surface is a boiling field of convection cells about the
      // size of Texas, and that mottling is the only "feature" it reliably shows.
      for (let i = 0; i < 900; i++) {
        const r = randomIn(rng, 2, 8);
        ctx.fillStyle = rng() > 0.5 ? `rgba(255,240,180,${0.12 + rng() * 0.3})` : `rgba(220,110,20,${0.1 + rng() * 0.25})`;
        ctx.beginPath(); ctx.arc(randomIn(rng, 0, w), randomIn(rng, 0, h), r, 0, Math.PI * 2); ctx.fill();
      }
      // A few sunspots, always in two belts either side of the equator -- never at the
      // poles, which is a real and checkable fact about the Sun.
      for (let i = 0; i < 7; i++) {
        const y = h * (rng() > 0.5 ? randomIn(rng, 0.3, 0.42) : randomIn(rng, 0.58, 0.7));
        const r = randomIn(rng, 5, 13);
        ctx.fillStyle = 'rgba(120,45,10,0.75)';
        ctx.beginPath(); ctx.ellipse(randomIn(rng, 0, w), y, r * 1.5, r, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(60,20,5,0.85)';
        ctx.beginPath(); ctx.ellipse(randomIn(rng, 0, w), y, r * 0.7, r * 0.5, 0, 0, Math.PI * 2); ctx.fill();
      }
    } else if (kind === 'mercury') {
      ctx.fillStyle = '#8c8378'; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 150; i++) crater(randomIn(rng, 0, w), randomIn(rng, 0, h), randomIn(rng, 3, 16));
    } else if (kind === 'venus') {
      // Venus shows no surface at all -- it is a featureless cream ball of cloud, and
      // that IS the identifying fact. Resisting the urge to draw continents is the point.
      ctx.fillStyle = '#e8d9a8'; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 40; i++) {
        const y = randomIn(rng, 0, h);
        ctx.strokeStyle = `rgba(${rng() > 0.5 ? '255,240,205' : '198,170,115'},${0.15 + rng() * 0.25})`;
        ctx.lineWidth = randomIn(rng, 4, 18);
        ctx.beginPath();
        ctx.moveTo(0, y);
        for (let x = 0; x <= w; x += 32) ctx.lineTo(x, y + Math.sin(x * 0.02 + i) * 7);
        ctx.stroke();
      }
    } else if (kind === 'earth') {
      ctx.fillStyle = '#1c4f8c'; ctx.fillRect(0, 0, w, h);
      // Continents, roughly where Earth's are, so the globe is recognisable as ours.
      const land = '#3f7a35';
      blob(110, 95, 26, land); blob(120, 150, 20, '#5c7a35');   // Americas
      blob(255, 105, 22, '#7a6a3a'); blob(268, 150, 24, land);  // Africa/Europe
      blob(350, 95, 40, '#6b7a3a');                             // Asia
      blob(400, 185, 18, '#8a7340');                            // Australia
      ctx.fillStyle = '#eef4f8';
      ctx.fillRect(0, 0, w, 14); ctx.fillRect(0, h - 16, w, 16); // ice caps
      // Cloud: the thing that makes Earth look alive rather than like a painted globe.
      for (let i = 0; i < 70; i++) {
        ctx.fillStyle = `rgba(255,255,255,${0.18 + rng() * 0.3})`;
        blob(randomIn(rng, 0, w), randomIn(rng, 20, h - 20), randomIn(rng, 8, 22), 'rgba(255,255,255,0.3)');
      }
    } else if (kind === 'moon') {
      ctx.fillStyle = '#9a958d'; ctx.fillRect(0, 0, w, h);
      // The maria -- the dark basalt seas that make the face of the Moon.
      ctx.fillStyle = 'rgba(70,68,66,0.75)';
      blob(150, 90, 40, 'rgba(70,68,66,0.75)'); blob(210, 120, 30, 'rgba(70,68,66,0.7)');
      blob(120, 140, 26, 'rgba(76,74,70,0.7)');
      for (let i = 0; i < 200; i++) crater(randomIn(rng, 0, w), randomIn(rng, 0, h), randomIn(rng, 2, 14));
    } else if (kind === 'mars') {
      ctx.fillStyle = '#b5562e'; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 50; i++) blob(randomIn(rng, 0, w), randomIn(rng, 30, h - 30), randomIn(rng, 10, 30), `rgba(110,60,38,${0.25 + rng() * 0.35})`);
      // Valles Marineris -- a canyon a fifth of the way round the planet.
      ctx.strokeStyle = 'rgba(90,45,28,0.8)'; ctx.lineWidth = 7;
      ctx.beginPath(); ctx.moveTo(180, 140); ctx.lineTo(330, 132); ctx.stroke();
      ctx.fillStyle = '#f0ece4';
      ctx.beginPath(); ctx.ellipse(w * 0.5, 6, 90, 18, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(w * 0.5, h - 5, 70, 15, 0, 0, Math.PI * 2); ctx.fill();
    } else if (kind === 'jupiter') {
      ctx.fillStyle = '#d8bc93'; ctx.fillRect(0, 0, w, h);
      const bands = [[0, 22, '245,232,205'], [22, 52, '176,132,92'], [52, 78, '236,220,190'],
        [78, 104, '150,106,72'], [104, 122, '228,206,175'], [122, 140, '196,140,96'],
        [140, 166, '240,226,198'], [166, 196, '164,118,80'], [196, 226, '232,214,182'], [226, 256, '186,146,104']];
      for (const [a, b, c] of bands) band(a, b, c, 0.95);
      // Turbulence at every band boundary -- straight edges are what make painted stripes.
      for (let i = 0; i < 260; i++) {
        const y = randomIn(rng, 0, h);
        ctx.fillStyle = `rgba(${rng() > 0.5 ? '255,245,220' : '140,98,66'},${0.1 + rng() * 0.2})`;
        ctx.beginPath(); ctx.ellipse(randomIn(rng, 0, w), y, randomIn(rng, 8, 34), randomIn(rng, 2, 6), 0, 0, Math.PI * 2); ctx.fill();
      }
      // The Great Red Spot: a storm wider than Earth, running for at least 350 years.
      ctx.fillStyle = '#c1552f';
      ctx.beginPath(); ctx.ellipse(300, 168, 46, 22, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(160,60,30,0.6)';
      ctx.beginPath(); ctx.ellipse(300, 168, 30, 13, 0, 0, Math.PI * 2); ctx.fill();
    } else if (kind === 'saturn') {
      ctx.fillStyle = '#e0cfa4'; ctx.fillRect(0, 0, w, h);
      const bands = [[0, 30, '238,226,196'], [30, 64, '214,192,148'], [64, 100, '240,228,198'],
        [100, 136, '206,182,138'], [136, 172, '236,222,190'], [172, 210, '212,190,146'], [210, 256, '232,216,184']];
      for (const [a, b, c] of bands) band(a, b, c, 0.9);
      for (let i = 0; i < 120; i++) {
        ctx.fillStyle = `rgba(${rng() > 0.5 ? '255,248,225' : '186,162,120'},${0.08 + rng() * 0.14})`;
        ctx.beginPath(); ctx.ellipse(randomIn(rng, 0, w), randomIn(rng, 0, h), randomIn(rng, 10, 40), randomIn(rng, 2, 5), 0, 0, Math.PI * 2); ctx.fill();
      }
    } else if (kind === 'uranus') {
      // Uranus is famously featureless -- a flat pale cyan disc. Voyager 2 flew past and
      // photographed essentially nothing, which is worth a student knowing.
      ctx.fillStyle = '#a8dbe0'; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 14; i++) band(randomIn(rng, 0, h), randomIn(rng, 0, h) + 20, '150,205,215', 0.16);
    } else if (kind === 'neptune') {
      ctx.fillStyle = '#2f5fc4'; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 20; i++) band(randomIn(rng, 0, h), randomIn(rng, 0, h) + 26, '30,70,160', 0.25);
      ctx.fillStyle = 'rgba(20,40,110,0.8)';
      ctx.beginPath(); ctx.ellipse(200, 110, 38, 20, 0, 0, Math.PI * 2); ctx.fill();
      for (let i = 0; i < 26; i++) {
        ctx.fillStyle = `rgba(235,245,255,${0.2 + rng() * 0.4})`;
        ctx.beginPath(); ctx.ellipse(randomIn(rng, 0, w), randomIn(rng, 20, h - 20), randomIn(rng, 8, 22), randomIn(rng, 2, 4), 0, 0, Math.PI * 2); ctx.fill();
      }
    } else {
      // Generic rocky moon.
      ctx.fillStyle = '#b0a89a'; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 90; i++) crater(randomIn(rng, 0, w), randomIn(rng, 0, h), randomIn(rng, 3, 12));
    }
  });
}

// ---------------------------------------------------------------------------
// The Sun
// ---------------------------------------------------------------------------

// Deliberately NOT to the size scale. At Earth = 1.6ft the Sun would be 175ft across and
// would be the entire world; here it is 18ft, and the placard says so outright. That is
// the honest version of the compromise -- a model that quietly shrinks the Sun teaches
// that the Sun is a bit bigger than Jupiter.
//
// Self-lit: `emissive` + `emissiveMap`, and no shadow casting. The theme's directional
// light comes from the Sun's side of the world, but the Sun's own body has to glow, or
// the brightest object in the solar system renders as a dull orange ball.
export function sunModel({ radius = 9, seed = 3 } = {}) {
  const g = group();
  const map = planetTexture('sun', seed);

  const core = mesh(
    new THREE.SphereGeometry(radius, 48, 32),
    standard({ map, emissive: 0xffaa33, emissiveMap: map, emissiveIntensity: 1.5, roughness: 1 }),
    0, radius + 1.5, 0,
  );
  core.castShadow = false;
  core.receiveShadow = false;
  g.add(core);

  // Corona: a backside-only shell, the same cheap fake-bloom trick the light orbs use,
  // since this app has no post-processing pipeline.
  //
  // MeshBasicMaterial with ADDITIVE blending, not a lit standard material. A BackSide
  // shell shows the far wall of the sphere, so its normals point in toward the centre and
  // AWAY from every light in the scene -- lit, it renders as a dark ring round the Sun,
  // which is precisely the opposite of a corona. Basic material ignores lighting entirely
  // and additive blending over a black sky is what actually reads as glow.
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.28, 32, 20),
    new THREE.MeshBasicMaterial({
      color: 0xff9a2e,
      transparent: true,
      opacity: 0.3,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    }),
  );
  halo.position.set(0, radius + 1.5, 0);
  halo.castShadow = false;
  halo.receiveShadow = false;
  g.add(halo);

  // Prominences -- loops of plasma arching off the limb, which is the Sun's one real
  // silhouette feature and the thing that makes it read as a star rather than a lamp.
  const rng = seededRandom(seed + 4);
  const loops = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + rng() * 0.5;
    const scale = randomIn(rng, 0.16, 0.34);
    const torus = new THREE.TorusGeometry(radius * scale, radius * 0.028, 6, 16, Math.PI * 1.15);
    loops.push({
      geometry: torus,
      color: 0xff8a2b,
      position: [Math.cos(a) * radius * 0.96, radius + 1.5 + Math.sin(a) * radius * 0.96, 0],
      rotation: [randomIn(rng, -0.5, 0.5), a, a + Math.PI / 2],
    });
  }
  const prom = mesh(mergeColored(loops), standard({ vertexColors: true, emissive: 0xff7a1e, emissiveIntensity: 1.3, roughness: 1, transparent: true, opacity: 0.85 }));
  prom.castShadow = false;
  g.add(prom);

  // A real light, so the Sun actually lights the planets standing near it.
  const light = new THREE.PointLight(0xfff0d0, 3.4, 120, 2);
  light.position.set(0, radius + 1.5, 0);
  light.userData.isLight = true;
  g.add(light);

  return g;
}

// ---------------------------------------------------------------------------
// Planets
// ---------------------------------------------------------------------------

// One builder for all eight, on a plinth so the body floats at eye level rather than
// sitting on the ground like a boulder. A planet resting on soil is the one thing that
// would make this world read as a garden of spheres.
//
// `tilt` is the real axial tilt, and it is not decoration: Uranus's 98 degrees -- it
// orbits lying on its side -- is one of the most striking facts in the solar system and
// it is invisible unless the models are actually tilted.
export function planetModel({
  kind = 'earth',
  radius = E,
  tilt = 0,
  rings = false,
  seed = 11,
  plinth = true,
  moons = [],
} = {}) {
  const g = group();
  const plinthH = plinth ? 3.2 : 0;

  if (plinth) {
    const dark = standard({ color: 0x2b2f3a, roughness: 0.6, metalness: 0.35, ...relief('metal', { seed: seed + 1, repeat: 3 }) });
    g.add(cyl(0.55, 0.95, plinthH, dark, 0, plinthH / 2, 0, 16));
    g.add(cyl(1.5, 1.7, 0.35, dark, 0, 0.17, 0, 20));
  }

  const cy = plinthH + radius + 0.5;
  const map = planetTexture(kind, seed);
  const body = mesh(
    new THREE.SphereGeometry(radius, 44, 30),
    standard({ map, roughness: kind === 'venus' || kind === 'uranus' ? 1 : 0.92, metalness: 0 }),
    0, cy, 0,
  );
  body.rotation.z = (tilt * Math.PI) / 180;
  g.add(body);

  // Rings. Saturn's are 170,000 miles across and 30ft thick -- essentially a sheet of
  // paper the width of a planet -- so a torus is the wrong solid entirely. A RingGeometry
  // is right, and it needs DoubleSide because from below you see its underside.
  if (rings) {
    const ringMap = canvasTexture(256, 32, (ctx, w, h) => {
      // Banding across the ring's radius, with the Cassini Division as a real gap.
      const stops = [[0, '#00000000'], [0.06, '#c9b48f'], [0.3, '#e2d3ae'], [0.42, '#a8926f'],
        [0.46, '#00000000'], [0.52, '#d8c8a2'], [0.82, '#bfa87e'], [1, '#00000000']];
      const grad = ctx.createLinearGradient(0, 0, w, 0);
      for (const [p, c] of stops) grad.addColorStop(p, c);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    });
    const ring = new THREE.RingGeometry(radius * 1.26, radius * 2.3, 72, 1);
    // RingGeometry's default UVs are square-mapped; remap u to the RADIUS so the band
    // texture runs across the ring rather than around it.
    const pos = ring.attributes.position;
    const uv = ring.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getY(i));
      uv.setXY(i, (r - radius * 1.26) / (radius * 2.3 - radius * 1.26), 0.5);
    }
    const ringMesh = mesh(ring, standard({ map: ringMap, transparent: true, side: THREE.DoubleSide, roughness: 1, opacity: 0.95 }), 0, cy, 0);
    ringMesh.rotation.x = Math.PI / 2;
    ringMesh.rotation.y = 0;
    ringMesh.rotation.z = (tilt * Math.PI) / 180;
    ringMesh.castShadow = false;
    g.add(ringMesh);
  }

  // Moons on a thin arm, so they read as belonging to this planet rather than floating.
  moons.forEach((m, i) => {
    const a = (i / Math.max(1, moons.length)) * Math.PI * 2 + 0.6;
    const dist = radius * 1.9 + 0.9 + i * 0.5;
    const mx = Math.cos(a) * dist;
    const mz = Math.sin(a) * dist;
    const mmap = planetTexture(m.kind || 'rock', seed + 20 + i);
    g.add(mesh(new THREE.SphereGeometry(m.radius, 22, 16), standard({ map: mmap, roughness: 0.95 }), mx, cy, mz));
    // The arm: thin, dark, and deliberately not a full orbit ring -- a ring at this scale
    // would be a hoop the size of the exhibit and would hide the planet behind it.
    const arm = cyl(0.035, 0.035, dist, standard({ color: 0x3a4050, roughness: 0.5, metalness: 0.4 }), mx / 2, cy, mz / 2, 6);
    arm.rotation.z = Math.PI / 2;
    arm.rotation.y = -a;
    g.add(arm);
  });

  return g;
}

// ---------------------------------------------------------------------------
// Walkway and markers
// ---------------------------------------------------------------------------

// The deck the whole system stands on: a long dark platform with a lit edge stripe. It is
// what stops this world reading as planets dropped on a field -- a walkthrough needs a
// path, and the path is what carries the distance markings.
// TWO meshes, and the split is the whole point. In deep space there is no sky to bounce
// light off -- the `solar` theme's hemisphere fill is nearly black on purpose, because
// out here it should be -- so a lit deck material renders as an invisible black slab and
// the student is walking on nothing. The edge stripes and cross ties are therefore
// EMISSIVE and self-lit, exactly like runway edge lighting: they mark the path without
// pretending there is ambient light out here to see it by.
export function orbitWalk({ length = 40, width = 9, seed = 5 } = {}) {
  const deck = [
    { geometry: new THREE.BoxGeometry(width, 0.4, length), color: 0x2b3040, position: [0, 0.2, 0] },
  ];

  const lit = [];
  for (const side of [-1, 1]) {
    lit.push({
      geometry: new THREE.BoxGeometry(0.3, 0.16, length),
      color: 0x7fb4ff,
      position: [side * (width / 2 - 0.25), 0.45, 0],
    });
  }
  // Cross ties every 8ft, which give the deck a sense of distance actually travelled.
  const ties = Math.max(2, Math.round(length / 8));
  for (let i = 0; i <= ties; i++) {
    lit.push({
      geometry: new THREE.BoxGeometry(width - 1.2, 0.08, 0.22),
      color: 0x46618f,
      position: [0, 0.44, -length / 2 + (i * length) / ties],
    });
  }

  const deckMesh = mergedMesh(deck, { roughness: 0.7, metalness: 0.25, ...relief('metal', { seed, repeat: 6 }) });
  const litMesh = mesh(
    mergeColored(lit),
    standard({ vertexColors: true, roughness: 1, emissive: 0x5f8fd0, emissiveIntensity: 1.1 }),
  );
  litMesh.castShadow = false;
  return group(deckMesh, litMesh);
}

// A distance marker: the real distance from the Sun, on a low angled plate. The whole
// point of a scale walk is that these numbers get absurd, and printing them is what makes
// the absurdity land.
export function distanceMarker({ label = '1 AU', sub = '93 million miles', accent = '#7fb4ff' } = {}) {
  const g = group();
  const texture = canvasTexture(512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#141824';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 6;
    ctx.strokeRect(10, 10, w - 20, h - 20);
    ctx.textAlign = 'center';
    ctx.fillStyle = accent;
    ctx.font = 'bold 84px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText(label, w / 2, h * 0.46);
    ctx.fillStyle = '#c8d4e8';
    ctx.font = '36px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText(sub, w / 2, h * 0.74);
  });
  const post = standard({ color: 0x2b2f3a, roughness: 0.6, metalness: 0.4 });
  g.add(cyl(0.12, 0.15, 2.6, post, 0, 1.3, 0, 10));
  const panel = signPanel(3.4, 1.7, texture, { emissive: 0x2a3550, emissiveIntensity: 0.5 });
  panel.position.set(0, 2.9, 0);
  panel.rotation.x = -0.42;
  g.add(panel);
  return g;
}

// The asteroid belt, between Mars and Jupiter. Deliberately SPARSE and small: the belt in
// every film is a boulder field you have to dodge, and the real one averages about a
// million miles between rocks. A student who leaves thinking it is crowded has learned
// something false, so this is a scatter of small bodies with a lot of space in it.
export function asteroidBelt({ count = 22, spread = 22, seed = 31 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  for (let i = 0; i < count; i++) {
    const r = randomIn(rng, 0.14, 0.45);
    const geo = roughenSphere(new THREE.IcosahedronGeometry(r, 1), { amount: 0.36, phase: i * 2.1 });
    parts.push({
      geometry: geo,
      color: [0x8a8177, 0x6f6862, 0x9c9186][i % 3],
      position: [randomIn(rng, -spread, spread), randomIn(rng, 2.5, 7.5), randomIn(rng, -spread * 0.3, spread * 0.3)],
      rotation: [rng() * 3, rng() * 3, rng() * 3],
    });
  }
  return group(mergedMesh(parts, { roughness: 0.95, flatShading: true, ...relief('stone', { seed: seed + 2, repeat: 2 }) }));
}

// A comet: a dirty snowball with a tail that always points AWAY from the Sun, regardless
// of which way the comet is travelling. That is the fact worth building -- almost everyone
// draws the tail streaming behind it like a jet.
export function comet({ length = 16, seed = 41 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const nucleus = roughenSphere(new THREE.IcosahedronGeometry(0.7, 2), { amount: 0.3 });
  g.add(mesh(nucleus, standard({ color: 0x6e6a66, roughness: 1, flatShading: true }), 0, 9, 0));

  // Coma.
  const coma = mesh(new THREE.SphereGeometry(1.8, 20, 14), standard({ color: 0x9fe8ff, transparent: true, opacity: 0.2, emissive: 0x4fb8e0, emissiveIntensity: 0.6, roughness: 1 }), 0, 9, 0);
  coma.castShadow = false;
  g.add(coma);

  // Two tails, because a comet has two and they point in slightly different directions:
  // a straight blue-white ion tail blown by the solar wind, and a broader, curved, dusty
  // one. Additive and unfogged, the same treatment the sea's light shafts need.
  for (const [w0, w1, color, opacity, bend] of [[1.4, 3.2, 0x9fd8ff, 0.28, 0], [1.9, 5.4, 0xe8dcc0, 0.16, 0.5]]) {
    const geo = new THREE.CylinderGeometry(w1, w0, length, 12, 1, true);
    const m = mesh(geo, standard({
      color, transparent: true, opacity, side: THREE.DoubleSide,
      emissive: color, emissiveIntensity: 0.5, roughness: 1, depthWrite: false,
    }), bend * 2, 9 + length / 2 * 0.6, -length / 2 * 0.8);
    m.material.fog = false;
    m.rotation.x = -0.9 + bend * 0.2;
    m.castShadow = false;
    m.receiveShadow = false;
    g.add(m);
  }
  return g;
}
