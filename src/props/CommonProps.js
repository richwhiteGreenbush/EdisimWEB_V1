import * as THREE from 'three';
import {
  standard,
  mesh,
  box,
  cyl,
  group,
  mergedMesh,
  cardTexture,
  signPanel,
  canvasTexture,
  seededRandom,
  randomIn,
  relief,
  wrapText,
  wrapLines,
} from '../PropKit.js';
import { CATEGORIES } from '../BlockDefs.js';

// Props shared by more than one preset world: the info placards that carry each
// world's teaching text, plain signage, benches, and lamp posts.

// A slanted reading label on a short stand -- the museum-label form factor, reused in
// all three worlds. Angled ~30 degrees off vertical so the text faces a standing
// 5ft reader looking slightly down at it.
// Two meshes: everything metal merges into one, and the printed face stays separate
// because it is the only part that needs its own canvas texture. There are 13 of these
// in the Park, so the merge is worth doing even though each is small.
export function infoPlacard({ title, body, eyebrow, accent = '#8c6b3f', height = 3.2, width = 2.2 } = {}) {
  const g = group();
  const metalColor = 0x3a3f45;
  const faceHeight = width * 0.625;
  const tilt = -Math.PI / 6;
  const headY = height + faceHeight * 0.28;

  g.add(
    mergedMesh(
      [
        { geometry: new THREE.CylinderGeometry(0.55, 0.62, 0.12, 20), position: [0, 0.06, 0], color: metalColor },
        {
          geometry: new THREE.CylinderGeometry(0.11, 0.13, height - 0.12, 14),
          position: [0, (height - 0.12) / 2 + 0.12, 0],
          color: metalColor,
        },
        {
          geometry: new THREE.BoxGeometry(width + 0.1, faceHeight + 0.1, 0.09),
          rotation: [tilt, 0, 0],
          position: [0, headY, 0],
          color: metalColor,
        },
      ],
      // Cast, not machined: a placard stand that is perfectly smooth reads as plastic.
      { roughness: 0.5, metalness: 0.6, ...relief('metal', { seed: 31, repeat: 2 }) }
    )
  );

  const face = signPanel(width, faceHeight, cardTexture({ title, body, eyebrow, accent }));
  face.position.set(0, headY + Math.sin(-tilt) * 0.051, Math.cos(tilt) * 0.051);
  face.rotation.x = tilt;
  g.add(face);

  return g;
}

// A flat wall-mounted plaque (no stand) -- for hanging next to artwork or on a
// building. `depth` pushes it off whatever surface it is placed against.
export function wallPlacard({ title, body, eyebrow, accent = '#8c6b3f', width = 1.6 } = {}) {
  const height = width * 0.625;
  const frame = standard({ color: 0x2f2b26, roughness: 0.6 });
  const g = group(box(width + 0.06, height + 0.06, 0.05, frame, 0, 0, 0));
  const face = signPanel(width, height, cardTexture({ title, body, eyebrow, accent }));
  face.position.z = 0.031;
  g.add(face);
  return g;
}

// Free-standing signage on two posts: a building name, an aisle heading, a trail sign.
export function standingSign({
  lines = ['SIGN'],
  subtitle = '',
  width = 8,
  height = 2.4,
  postHeight = 5,
  face = '#1d3b2a',
  ink = '#f3ead6',
  accent = '#c9a227',
} = {}) {
  const post = standard({ color: 0x4a4136, roughness: 0.85, ...relief('wood', { seed: 17, repeat: 4 }) });
  const g = group();

  const inset = width / 2 - 0.5;
  g.add(cyl(0.16, 0.2, postHeight, post, -inset, postHeight / 2, 0, 12));
  g.add(cyl(0.16, 0.2, postHeight, post, inset, postHeight / 2, 0, 12));

  const texture = canvasTexture(1024, 1024 * (height / width), (ctx, w, h) => {
    ctx.fillStyle = face;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 10;
    ctx.strokeRect(16, 16, w - 32, h - 32);

    ctx.fillStyle = ink;
    ctx.textAlign = 'center';
    const titleSize = subtitle ? h * 0.3 : h * 0.4;
    ctx.font = `bold ${titleSize}px Georgia, "Times New Roman", serif`;
    const startY = subtitle ? h * 0.42 : h * 0.62;
    lines.forEach((line, i) => ctx.fillText(line, w / 2, startY + i * titleSize * 1.1));

    if (subtitle) {
      ctx.fillStyle = accent;
      ctx.font = `${h * 0.15}px "Helvetica Neue", Arial, sans-serif`;
      ctx.fillText(subtitle, w / 2, h * 0.78);
    }
  });

  const panelY = postHeight - height / 2 - 0.4;
  const panel = signPanel(width, height, texture);
  panel.position.set(0, panelY, 0.001);
  g.add(box(width + 0.12, height + 0.12, 0.1, post, 0, panelY, -0.06), panel);

  return g;
}

// Park/gallery bench: slatted seat and back on two cast legs. ~1.5ft seat height,
// which reads correctly against the 5ft player.
// Merged to one mesh. There are nine of these in the Park alone and fifteen slats and
// legs apiece, so leaving them unmerged costs ~250 draw calls across the main and
// shadow passes for nothing but park furniture.
export function bench({ length = 5, woodColor = 0x8a5a32 } = {}) {
  const parts = [];
  const iron = 0x2c2f33;

  for (const side of [-1, 1]) {
    const x = side * (length / 2 - 0.4);
    parts.push({ geometry: new THREE.BoxGeometry(0.16, 1.45, 0.16), position: [x, 0.725, -0.55], color: iron });
    parts.push({ geometry: new THREE.BoxGeometry(0.16, 1.45, 0.16), position: [x, 0.725, 0.55], color: iron });
    parts.push({ geometry: new THREE.BoxGeometry(0.16, 0.16, 1.3), position: [x, 1.45, 0], color: iron });
    parts.push({ geometry: new THREE.BoxGeometry(0.14, 1.4, 0.14), position: [x, 2.1, -0.55], color: iron });
  }

  for (let i = 0; i < 4; i++) {
    parts.push({ geometry: new THREE.BoxGeometry(length, 0.11, 0.28), position: [0, 1.56, -0.5 + i * 0.34], color: woodColor });
  }
  for (let i = 0; i < 3; i++) {
    parts.push({ geometry: new THREE.BoxGeometry(length, 0.3, 0.1), position: [0, 2.0 + i * 0.38, -0.62], color: woodColor });
  }

  // One bump map over the whole merge, so the grain runs across the cast legs as well
  // as the slats. That is not wrong -- cast iron of this period is visibly grainy too --
  // and it is the price of the merge that keeps a bench at one draw call.
  return group(mergedMesh(parts, { roughness: 0.75, ...relief('wood', { seed: 23, repeat: 5 }) }));
}

// Lamp post with a real PointLight inside the globe, so it genuinely lights the
// ground under it rather than only looking lit.
export function lampPost({ height = 11, color = 0xffe6b0, intensity = 1.6 } = {}) {
  const iron = standard({ color: 0x24272b, roughness: 0.55, metalness: 0.5, ...relief('metal', { seed: 41, repeat: 3 }) });
  const g = group();

  g.add(cyl(0.32, 0.44, 0.5, iron, 0, 0.25, 0, 18));
  g.add(cyl(0.14, 0.2, height, iron, 0, height / 2 + 0.4, 0, 16));

  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(0.6, 24, 16),
    standard({ color: 0xfff4d8, emissive: new THREE.Color(color), emissiveIntensity: 2.4, roughness: 0.4 })
  );
  globe.position.y = height + 0.7;
  globe.userData.isGlowMesh = true;
  g.add(globe);

  g.add(cyl(0.32, 0.12, 0.5, iron, 0, height + 1.35, 0, 16));

  const light = new THREE.PointLight(color, intensity, 34, 2);
  light.position.y = height + 0.7;
  g.add(light);

  return g;
}

// A full-grown shade tree, ~22ft, built from a tapered forked trunk and overlapping
// low-poly foliage masses. Generated rather than loaded so its height is exact against
// the 5ft player (a real street tree is four or five times a person, not the 5ft the
// import pipeline would normalize a downloaded model to).
// Trunk, limbs AND canopy all merge into a SINGLE vertex-colored mesh. A tree built
// the obvious way -- one mesh per canopy blob -- costs seven draw calls, and the park
// alone plants twenty-odd of them; merging takes the whole world from ~1200 calls to
// something a school Chromebook can hold at 60fps. Flat shading does the work that
// separate materials would otherwise have done.
export function shadeTree({ height = 22, seed = 4, leafColor = 0x4c7d33, trunkColor = 0x5d4530 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const trunkHeight = height * 0.42;

  parts.push({
    geometry: new THREE.CylinderGeometry(height * 0.026, height * 0.055, trunkHeight, 10),
    position: [0, trunkHeight / 2, 0],
    color: trunkColor,
  });
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2 + randomIn(rng, -0.3, 0.3);
    const lean = randomIn(rng, 0.5, 0.9);
    const limbLength = height * randomIn(rng, 0.2, 0.3);
    parts.push({
      geometry: new THREE.CylinderGeometry(height * 0.012, height * 0.024, limbLength, 8),
      rotation: [Math.sin(angle) * lean, 0, -Math.cos(angle) * lean],
      position: [
        Math.cos(angle) * limbLength * 0.38,
        trunkHeight + limbLength * 0.34,
        Math.sin(angle) * limbLength * 0.38,
      ],
      color: trunkColor,
    });
  }

  const crownY = trunkHeight + height * 0.24;
  const crownRadius = height * 0.3;
  const shade = new THREE.Color(leafColor);
  // Detail 2 on the main mass only. At detail 1 a 6-7ft-radius crown is a visibly
  // twenty-sided lump from underneath, which is exactly where a student stands; the
  // satellite blobs are small enough that the extra 240 triangles each would buy
  // nothing.
  parts.push({ geometry: new THREE.IcosahedronGeometry(crownRadius, 2), position: [0, crownY, 0], color: leafColor });
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2 + 0.6;
    parts.push({
      geometry: new THREE.IcosahedronGeometry(crownRadius * randomIn(rng, 0.5, 0.72), 1),
      rotation: [rng() * 3, rng() * 3, rng() * 3],
      position: [
        Math.cos(angle) * crownRadius * 0.85,
        crownY + randomIn(rng, -0.35, 0.4) * crownRadius,
        Math.sin(angle) * crownRadius * 0.85,
      ],
      color: shade.clone().multiplyScalar(randomIn(rng, 0.82, 1.14)).getHex(),
    });
  }

  // Bark relief over the whole merge. On the trunk and limbs it is doing its real job;
  // on the canopy the same fibres read as leaf clutter, which is a bonus rather than a
  // compromise -- a flat-shaded blob is the one part of this tree that most gives away
  // that it was generated.
  return group(mergedMesh(parts, { roughness: 0.9, flatShading: true, ...relief('bark', { seed, repeat: 3 }) }));
}

// A "your turn" board: a big, bright sign setting a programming challenge for one
// particular object in the world, with the exact blocks to snap together.
//
// Deliberately loud, and deliberately unlike infoPlacard. A placard is a museum label —
// cream card, brown rule, read it if you like. This is a call to action, and it has to
// win against a T. rex or a heart the size of a car for a student's attention, so it is
// twice the size, chest-height on two posts, and led by a saturated colour band.
//
// The step chips are coloured from `CATEGORIES` in BlockDefs.js, NOT from a copy of
// those hex values. That import is the whole trick of this prop: the orange chip on the
// sign is the same orange as the `repeat` block the student is about to go and drag, so
// the sign is teaching the palette at the same time as the task. Redefining the colours
// locally would let the two drift apart silently, which is exactly the confusion this is
// meant to prevent.
export function activityBoard({
  number = 1,
  title = 'Your turn',
  target = '',
  steps = [],
  tip = '',
  accent = '#ff7a3d',
  width = 6.4,
  height = 5.5,
  postHeight = 9,
} = {}) {
  const post = standard({ color: 0x39332b, roughness: 0.7, metalness: 0.3, ...relief('metal', { seed: 97, repeat: 3 }) });
  const g = group();

  // Posts OUTSIDE the panel, not tucked inside its edges the way standingSign puts
  // them. That works there because its text is centred; here every line is left-aligned
  // and starts a few inches in from the edge, so an inset post stands directly in front
  // of the first character of every single line.
  const inset = width / 2 + 0.28;
  g.add(cyl(0.17, 0.22, postHeight, post, -inset, postHeight / 2, 0, 12));
  g.add(cyl(0.17, 0.22, postHeight, post, inset, postHeight / 2, 0, 12));

  const texture = canvasTexture(1024, 880, (ctx, w, h) => {
    const round = (x, y, rw, rh, r) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + rw, y, x + rw, y + rh, r);
      ctx.arcTo(x + rw, y + rh, x, y + rh, r);
      ctx.arcTo(x, y + rh, x, y, r);
      ctx.arcTo(x, y, x + rw, y, r);
      ctx.closePath();
    };

    ctx.fillStyle = '#fdfaf3';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 16;
    ctx.strokeRect(8, 8, w - 16, h - 16);

    // Header band.
    ctx.fillStyle = accent;
    ctx.fillRect(16, 16, w - 32, 116);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 52px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('⚡ ACTIVITY', 46, 94);
    ctx.textAlign = 'right';
    ctx.font = 'bold 62px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText(String(number), w - 46, 98);
    ctx.textAlign = 'left';

    let y = 208;
    ctx.fillStyle = '#241f1a';
    ctx.font = 'bold 50px Georgia, "Times New Roman", serif';
    y = wrapText(ctx, title, 46, y, w - 92, 58);

    if (target) {
      ctx.fillStyle = '#5d5348';
      ctx.font = '30px "Helvetica Neue", Arial, sans-serif';
      y = wrapText(ctx, target, 46, y + 26, w - 92, 38) + 14;
    }

    // The blocks, drawn as the chips they will look like in the editor. Indented by
    // depth, because a student's first real difficulty with a C-block is not knowing
    // that "inside" is a place.
    for (const step of steps) {
      const depth = step.depth || 0;
      const x = 46 + depth * 40;
      ctx.font = 'bold 30px "Helvetica Neue", Arial, sans-serif';
      const chipWidth = Math.min(w - 92 - depth * 40, ctx.measureText(step.text).width + 52);
      const fill = CATEGORIES[step.cat]?.fill || '#8d8d8d';
      const dark = CATEGORIES[step.cat]?.dark || '#5f5f5f';
      ctx.fillStyle = dark;
      round(x, y + 5, chipWidth, 52, 16);
      ctx.fill();
      ctx.fillStyle = fill;
      round(x, y, chipWidth, 52, 16);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(step.text, x + 26, y + 36);
      y += 66;
    }

    if (tip) {
      const top = Math.max(y + 16, h - 132);
      ctx.fillStyle = 'rgba(0,0,0,0.055)';
      round(30, top, w - 60, h - top - 30, 18);
      ctx.fill();
      ctx.fillStyle = '#4a4137';
      ctx.font = 'italic 27px Georgia, "Times New Roman", serif';
      wrapText(ctx, tip, 56, top + 46, w - 112, 34);
    }
  });

  // Self-lit, using its own artwork as the emissive map.
  //
  // A big flat panel facing away from the sun is a black silhouette -- the trap this
  // project has already hit on Mars -- and it bites hardest here, because this is the one
  // sign a student MUST be able to read. On the Moon, with the hemisphere fill at 0.35
  // and no atmosphere to bounce anything, a board turned even slightly away from the sun
  // came out as a solid black rectangle. Aiming every board at the sun is not a fix
  // either: they can be approached from any direction, in any world.
  //
  // The intensity is a balance -- high enough to stay legible in lunar shadow, low enough
  // that it is not a backlit advertising hoarding at noon in the park.
  const panelY = postHeight - height / 2 - 0.5;
  const panel = signPanel(width, height, texture, { emissive: '#ffffff', emissiveIntensity: 0.5 });
  panel.position.set(0, panelY, 0.001);
  g.add(box(width + 0.16, height + 0.16, 0.12, post, 0, panelY, -0.07), panel);

  return g;
}

// A big greeting board: a few lines of large centred type saying what this place is for.
//
// Deliberately NOT an infoPlacard or a standingSign. A placard is a museum label you
// stoop to read, and standingSign is built around one line plus a subtitle -- give it
// three and the third falls off the bottom of its own canvas, because it sizes its type
// off the panel height and starts at a fixed fraction of it. This one measures its whole
// block of text first and centres it, so the caller can pass one line or four.
//
// The face is dark, unlike the two cream boards it stands beside. In an open field the
// only things to see are green ground and blue sky, and a third cream rectangle in the
// row would read as one more of the same; the dark panel with white type is the one a
// student's eye goes to first.
export function welcomeBoard({
  eyebrow = '',
  lead = '',
  lines = [],
  footnote = '',
  face = '#15334d',
  ink = '#f6f2e7',
  accent = '#ffc457',
  width = 12,
  height = 4.6,
  postHeight = 9.2,
} = {}) {
  const post = standard({ color: 0x39332b, roughness: 0.7, metalness: 0.3, ...relief('metal', { seed: 41, repeat: 3 }) });
  const g = group();

  const inset = width / 2 + 0.3;
  g.add(cyl(0.2, 0.26, postHeight, post, -inset, postHeight / 2, 0, 12));
  g.add(cyl(0.2, 0.26, postHeight, post, inset, postHeight / 2, 0, 12));

  const texture = canvasTexture(1400, Math.round(1400 * (height / width)), (ctx, w, h) => {
    ctx.fillStyle = face;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 12;
    ctx.strokeRect(20, 20, w - 40, h - 40);

    const eyebrowSize = Math.round(h * 0.075);
    const leadSize = Math.round(h * 0.115);
    const bigSize = Math.round(h * 0.185);
    const footSize = Math.round(h * 0.08);

    // The big lines are SHRUNK TO FIT, and every line takes the same reduced size so the
    // block still reads as one block.
    //
    // Without this they are drawn at a fixed size with no measurement at all, so one line
    // a few words too long simply runs off both edges of the board -- clipped mid-word,
    // with nothing on screen to say why. A caller cannot predict the limit either, since
    // it depends on the board's width and on how many lines there are. This is the same
    // treatment cardTexture() already gives its body text, and for the same reason.
    //
    // It is measured HERE, above blockH, because blockH is what centres the whole stack
    // vertically -- computed from the unfitted size, a shrunk block sits visibly low.
    const maxLineWidth = w - 130;                 // inside the accent rule, with air
    let fitted = bigSize;
    ctx.font = `bold ${fitted}px "Helvetica Neue", Arial, sans-serif`;
    for (const line of lines) {
      while (fitted > 12 && ctx.measureText(line).width > maxLineWidth) {
        fitted -= 2;
        ctx.font = `bold ${fitted}px "Helvetica Neue", Arial, sans-serif`;
      }
    }

    // Measured and centred as a block, rather than laid out from a fixed top: the
    // caller decides how many lines there are, and only the total tells us where to start.
    const blockH =
      (eyebrow ? eyebrowSize * 1.9 : 0) +
      (lead ? leadSize * 1.6 : 0) +
      lines.length * fitted * 1.2 +
      (footnote ? footSize * 2.1 : 0);

    ctx.textAlign = 'center';
    let y = (h - blockH) / 2;

    if (eyebrow) {
      ctx.fillStyle = accent;
      ctx.font = `bold ${eyebrowSize}px "Helvetica Neue", Arial, sans-serif`;
      ctx.fillText(eyebrow, w / 2, y + eyebrowSize);
      y += eyebrowSize * 1.9;
    }

    if (lead) {
      ctx.fillStyle = 'rgba(246,242,231,0.78)';
      ctx.font = `${leadSize}px "Helvetica Neue", Arial, sans-serif`;
      ctx.fillText(lead, w / 2, y + leadSize);
      y += leadSize * 1.6;
    }

    // The last line takes the accent colour. On a board whose whole job is one sentence,
    // that is what stops it reading as a paragraph and makes it land as a call to action.
    ctx.font = `bold ${fitted}px "Helvetica Neue", Arial, sans-serif`;
    lines.forEach((line, i) => {
      ctx.fillStyle = i === lines.length - 1 ? accent : ink;
      ctx.fillText(line, w / 2, y + fitted);
      y += fitted * 1.2;
    });

    if (footnote) {
      ctx.fillStyle = 'rgba(246,242,231,0.62)';
      ctx.font = `italic ${footSize}px Georgia, "Times New Roman", serif`;
      ctx.fillText(footnote, w / 2, y + footSize * 1.4);
    }

    ctx.textAlign = 'left';
  });

  // Emissive for the same reason activityBoard is: a big flat panel with the sun behind
  // it renders as a black slab, and this is the first thing a student is meant to read.
  const panelY = postHeight - height / 2 - 0.5;
  const panel = signPanel(width, height, texture, { emissive: '#ffffff', emissiveIntensity: 0.45 });
  panel.position.set(0, panelY, 0.001);
  g.add(box(width + 0.18, height + 0.18, 0.14, post, 0, panelY, -0.08), panel);

  return g;
}

// A walkthrough on a board: the steps of one tutorial, standing in the world the student
// is meant to follow them in.
//
// It carries BOTH numbered instructions and block chips because the two tutorials it was
// built for need one each -- building a rocket is a list of things to do with the mouse,
// programming it is a stack of blocks to copy -- and a student meets them back to back.
// Two prop kinds that differed only in which half they drew would drift apart.
//
// The chips come from `CATEGORIES` in BlockDefs.js, exactly as activityBoard's do: the
// orange chip painted here is the same orange as the block being described, so the board
// teaches the palette while it teaches the task.
export function tutorialBoard({
  kicker = 'HOW TO',
  number = null,
  title = '',
  intro = '',
  steps = [],
  blocks = [],
  tip = '',
  accent = '#c2521f',
  width = 9,
  height = 7.6,
  postHeight = 10.6,
} = {}) {
  const post = standard({ color: 0x39332b, roughness: 0.7, metalness: 0.3, ...relief('metal', { seed: 73, repeat: 3 }) });
  const g = group();

  // Posts outside the panel, not inset -- every line here is left-aligned and starts a
  // few inches in, so an inset post stands in front of the first character of all of them.
  const inset = width / 2 + 0.28;
  g.add(cyl(0.17, 0.22, postHeight, post, -inset, postHeight / 2, 0, 12));
  g.add(cyl(0.17, 0.22, postHeight, post, inset, postHeight / 2, 0, 12));

  const texture = canvasTexture(1200, Math.round(1200 * (height / width)), (ctx, w, h) => {
    const round = (x, y, rw, rh, r) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + rw, y, x + rw, y + rh, r);
      ctx.arcTo(x + rw, y + rh, x, y + rh, r);
      ctx.arcTo(x, y + rh, x, y, r);
      ctx.arcTo(x, y, x + rw, y, r);
      ctx.closePath();
    };

    ctx.fillStyle = '#fdfaf3';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 18;
    ctx.strokeRect(9, 9, w - 18, h - 18);

    ctx.fillStyle = accent;
    ctx.fillRect(18, 18, w - 36, 122);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 54px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText(kicker, 50, 100);
    if (number !== null) {
      ctx.textAlign = 'right';
      ctx.font = 'bold 62px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText(String(number), w - 50, 102);
      ctx.textAlign = 'left';
    }

    const LEFT = 50;
    const COL = w - LEFT * 2;

    let headY = 216;
    if (title) {
      ctx.fillStyle = '#241f1a';
      ctx.font = 'bold 58px Georgia, "Times New Roman", serif';
      headY = wrapText(ctx, title, LEFT, headY, COL, 66);
    }
    if (intro) {
      ctx.fillStyle = '#5d5348';
      ctx.font = '31px "Helvetica Neue", Arial, sans-serif';
      headY = wrapText(ctx, intro, LEFT, headY + 20, COL, 39);
    }

    // One routine, run twice: once to measure and once to draw. Doing it any other way
    // means two pieces of layout arithmetic that have to agree and eventually will not.
    const body = (startY, size, paint) => {
      const lineH = Math.round(size * 1.3);
      const indent = Math.round(size * 2);
      const colW = COL - indent;
      let y = startY;

      const line = (text, x) => {
        if (paint) ctx.fillText(text, x, y + size * 0.82);
        y += lineH;
      };

      // Blocks BEFORE steps. A coding card reads "here is the stack, now go and change
      // it", so the thing to copy has to come first and the numbered steps are what to do
      // once it is running. A building card passes no blocks at all, so this costs it
      // nothing. Indented by depth, because a student's first real difficulty with a
      // C-block is not knowing that "inside" is a place.
      for (const block of blocks) {
        const depth = block.depth || 0;
        const x = LEFT + depth * 44;
        const chipH = Math.round(size * 1.7);
        ctx.font = `bold ${size}px "Helvetica Neue", Arial, sans-serif`;
        const chipW = Math.min(COL - depth * 44, ctx.measureText(block.text).width + 52);
        if (paint) {
          ctx.fillStyle = CATEGORIES[block.cat]?.dark || '#5f5f5f';
          round(x, y + 5, chipW, chipH, 16);
          ctx.fill();
          ctx.fillStyle = CATEGORIES[block.cat]?.fill || '#8d8d8d';
          round(x, y, chipW, chipH, 16);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.fillText(block.text, x + 26, y + chipH * 0.7);
        }
        y += chipH + Math.round(size * 0.36);
      }
      if (blocks.length && steps.length) y += Math.round(size * 0.5);

      steps.forEach((step, i) => {
        const top = y;
        if (step.lead) {
          ctx.font = `bold ${size}px "Helvetica Neue", Arial, sans-serif`;
          if (paint) ctx.fillStyle = '#241f1a';
          for (const l of wrapLines(ctx, step.lead, colW)) line(l, LEFT + indent);
        }
        if (step.text) {
          ctx.font = `${size}px "Helvetica Neue", Arial, sans-serif`;
          if (paint) ctx.fillStyle = '#4a4137';
          for (const l of wrapLines(ctx, step.text, colW)) line(l, LEFT + indent);
        }
        // The number disc last, from the row's remembered top: it has to be positioned
        // against the first line of the step, which is only known once the step is laid out.
        if (paint) {
          const r = size * 0.62;
          ctx.fillStyle = accent;
          ctx.beginPath();
          ctx.arc(LEFT + r + 2, top + r + 3, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.font = `bold ${Math.round(size * 0.8)}px "Helvetica Neue", Arial, sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText(String(i + 1), LEFT + r + 2, top + r * 1.35 + 3);
          ctx.textAlign = 'left';
        }
        y += Math.round(size * 0.44);
      });

      return y - startY;
    };

    // Fit the steps to whatever room the title left, the way cardTexture fits its body.
    // How many lines a wrapped title runs to is not something a caller can predict from
    // the outside, and a board with its last step cut off is worse than one set smaller.
    const tipTop = tip ? h - 156 : h - 34;
    const available = tipTop - (headY + 26);
    let size = 34;
    while (size > 22 && body(0, size, false) > available) size -= 2;
    body(headY + 26, size, true);

    if (tip) {
      ctx.fillStyle = 'rgba(0,0,0,0.055)';
      round(30, tipTop, w - 60, h - tipTop - 30, 18);
      ctx.fill();
      ctx.fillStyle = '#4a4137';
      ctx.font = 'italic 28px Georgia, "Times New Roman", serif';
      wrapText(ctx, tip, 56, tipTop + 46, w - 112, 35);
    }
  });

  const panelY = postHeight - height / 2 - 0.5;
  const panel = signPanel(width, height, texture, { emissive: '#ffffff', emissiveIntensity: 0.5 });
  panel.position.set(0, panelY, 0.001);
  g.add(box(width + 0.16, height + 0.16, 0.12, post, 0, panelY, -0.07), panel);

  return g;
}

// The stand a web browser panel sits on.
//
// A browser panel is a WebGL bezel with a CSS3D <iframe> welded to its transform, and
// nothing else -- so left on its own it hangs in mid-air with clear sky underneath,
// which reads as a bug rather than as a screen. This is the missing furniture: a plinth,
// a column and a surround sized to the panel, so the thing looks bolted down.
//
// It is a SEPARATE placed object from the panel, not part of it. The panel has to stay
// exactly what it is -- one bezel mesh that Size/Move/Program and persistence already
// understand -- and welding scenery into it would mean every one of those paths growing
// a special case. The cost is that resizing the panel does not resize the stand, which
// is the right trade: a student who shrinks a panel has moved on from caring about its
// furniture.
export function browserKiosk({ width = 4, panelHeight = 2.6, centreY = 4 } = {}) {
  const steel = standard({ color: 0x2a2f35, roughness: 0.45, metalness: 0.65, ...relief('metal', { seed: 53, repeat: 3 }) });
  const g = group();

  const sillY = centreY - panelHeight / 2; // the panel's bottom edge -- where the column stops
  const inset = width / 2 - 0.18;

  g.add(cyl(1.15, 1.45, 0.22, steel, 0, 0.11, 0, 24));
  g.add(box(0.85, sillY - 0.22, 0.5, steel, 0, 0.22 + (sillY - 0.22) / 2, -0.1));
  g.add(box(width + 0.36, 0.26, 0.42, steel, 0, sillY - 0.05, -0.1));

  // A surround rather than a solid backing board: the panel is double-sided DOM content
  // and a backing board behind it would be the only thing visible from behind.
  for (const side of [-1, 1]) {
    g.add(box(0.22, panelHeight + 0.5, 0.32, steel, side * inset, centreY, -0.1));
  }
  g.add(box(width + 0.36, 0.22, 0.32, steel, 0, centreY + panelHeight / 2 + 0.15, -0.1));

  return g;
}

// A billboard that is a DOOR to another world: clicking it loads the world named in
// `world` instead of opening the usual Size/Move/Program panel.
//
// The travelling itself is not done here. This builder only stamps `portalWorld` onto the
// group it returns; ObjectMenu reads that off the picked object and reroutes the click.
// That split is deliberate -- a prop builder has no business knowing what a world store
// is, and putting the flag in userData means the whole existing pipeline (records,
// IndexedDB, world files, the duplicate block) carries a portal with no special cases at
// all, since the flag is rebuilt from the record's options on every load like everything
// else about a preset prop.
//
// It is deliberately LOUD and it deliberately says what it does. Every other object in
// this app opens a menu when you click it, so a sign that silently replaces the entire
// world would be a nasty surprise; the call-to-action strip along the bottom is what
// makes it a door rather than a trapdoor.
export function worldPortal({
  title = 'ANOTHER WORLD',
  subtitle = '',
  world = '',
  accent = '#c1272d',
  face = '#141c2e',
  width = 15,
  height = 8.5,
  postHeight = 14,
} = {}) {
  const post = standard({ color: 0x33383d, roughness: 0.6, metalness: 0.45, ...relief('metal', { seed: 67, repeat: 3 }) });
  const g = group();

  // Posts outside the panel, for activityBoard's reason: this artwork is edge-to-edge,
  // and an inset post stands in front of it.
  const inset = width / 2 + 0.4;
  g.add(cyl(0.22, 0.3, postHeight, post, -inset, postHeight / 2, 0, 12));
  g.add(cyl(0.22, 0.3, postHeight, post, inset, postHeight / 2, 0, 12));
  g.add(box(width + 1.6, 0.3, 0.5, post, 0, postHeight - 0.2, 0));

  const texture = canvasTexture(1024, Math.round((1024 * height) / width), (ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, face);
    grad.addColorStop(1, '#2a3550');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = accent;
    ctx.lineWidth = 14;
    ctx.strokeRect(10, 10, w - 20, h - 20);

    ctx.fillStyle = accent;
    ctx.fillRect(20, 20, w - 40, h * 0.16);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = `bold ${h * 0.1}px "Helvetica Neue", Arial, sans-serif`;
    ctx.fillText('✦  TRAVEL TO  ✦', w / 2, h * 0.135);

    ctx.fillStyle = '#f7f1de';
    let size = h * 0.26;
    ctx.font = `bold ${size}px Georgia, "Times New Roman", serif`;
    while (size > 12 && ctx.measureText(title).width > w * 0.88) {
      size -= 2;
      ctx.font = `bold ${size}px Georgia, "Times New Roman", serif`;
    }
    ctx.fillText(title, w / 2, h * 0.5);

    // Fitted to the gap between the title and the call-to-action strip, the same way
    // cardTexture sizes its body: how many lines a subtitle wraps to is not something the
    // caller can predict, and a sentence running under the yellow bar and off the bottom
    // of the board is worse than one set a point smaller.
    if (subtitle) {
      ctx.fillStyle = '#c8d3e8';
      const top = h * 0.61;
      const room = h * 0.77 - top;
      let lines = [];
      let lineHeight = h * 0.095;
      for (const size of [0.075, 0.068, 0.061, 0.054, 0.048]) {
        ctx.font = `${h * size}px "Helvetica Neue", Arial, sans-serif`;
        lineHeight = h * size * 1.28;
        lines = wrapLines(ctx, subtitle, w * 0.84);
        if (lines.length * lineHeight <= room) break;
      }
      lines.forEach((line, i) => ctx.fillText(line, w / 2, top + lineHeight * (i + 0.85)));
    }

    ctx.fillStyle = '#ffd766';
    ctx.fillRect(w * 0.16, h * 0.79, w * 0.68, h * 0.14);
    ctx.fillStyle = '#241f1a';
    ctx.font = `bold ${h * 0.085}px "Helvetica Neue", Arial, sans-serif`;
    ctx.fillText('👆  CLICK THIS SIGN TO GO', w / 2, h * 0.885);
  });

  const panelY = postHeight - height / 2 - 0.6;
  // Self-lit for activityBoard's reason: this one has to be legible from whichever side
  // of it a student happens to walk up on, and it is often standing in a building's shade.
  const panel = signPanel(width, height, texture, { emissive: '#ffffff', emissiveIntensity: 0.55 });
  panel.position.set(0, panelY, 0.001);
  g.add(box(width + 0.3, height + 0.3, 0.16, post, 0, panelY, -0.09), panel);

  g.userData.portalWorld = world;
  return g;
}

// A shallow planter box with a simple shrub -- softens the plaza edges outdoors.
export function planter({ size = 3, shrubColor = 0x3f7a3a } = {}) {
  const stone = standard({ color: 0xb9b3a6, roughness: 0.95, ...relief('stone', { seed: 13, repeat: 2 }) });
  const soil = standard({ color: 0x3a2d21, roughness: 1, ...relief('soil', { seed: 19, repeat: 3 }) });
  const leaf = standard({ color: shrubColor, roughness: 0.9, flatShading: true });
  const g = group();

  const wall = 0.22;
  for (const [dx, dz, w, d] of [
    [0, size / 2 - wall / 2, size, wall],
    [0, -size / 2 + wall / 2, size, wall],
    [size / 2 - wall / 2, 0, wall, size - wall * 2],
    [-size / 2 + wall / 2, 0, wall, size - wall * 2],
  ]) {
    g.add(box(w, 1.5, d, stone, dx, 0.75, dz));
  }
  g.add(box(size - wall * 2, 1.3, size - wall * 2, soil, 0, 0.65, 0));

  g.add(mesh(new THREE.IcosahedronGeometry(size * 0.42, 1), leaf, 0, 1.3 + size * 0.3, 0));
  g.add(mesh(new THREE.IcosahedronGeometry(size * 0.28, 1), leaf, size * 0.22, 1.3 + size * 0.16, -size * 0.16));

  return g;
}
