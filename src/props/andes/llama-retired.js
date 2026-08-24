import * as THREE from 'three';
import { group, mergedMesh, relief, taperedTube, seededRandom } from '../../PropKit.js';

// THE RETIRED PROCEDURAL LLAMA.
//
// Machu Picchu no longer places this: it uses the shipped model in public/llama/ through
// the `startup-llama` record kind (see StartupAssets.loadLlamaModel). This builder stays
// because its prop key `llama` is PERSISTED -- it sits inside every copy of world 21 that
// a student has already saved to IndexedDB, downloaded as a world file, or sent to a
// classmate. buildProp() throws on an unknown name and WorldStore catches per record, so
// deleting this would not tidy anything up: it would turn three objects in somebody's
// saved world into three console lines and a hole in the terraces.
//
// Same rule the retired moveX/moveY/moveZ blocks follow: a thing that ends up inside a
// saved record is only ever added to, never removed.

// A llama. The pack animal that made the whole Inca road system work, and the reason
// there are no wheeled vehicles anywhere in this empire: a llama goes up a staircase.
//
// What makes it a llama rather than a sheep on stilts: the neck is long, held UPRIGHT and
// carried well clear of the back; the ears are long and curve inward like banana skins;
// there is no hump; and the legs are slender and long for the body.
export function llama({ height = 5.6, fleece = 0xd8cbb0, seed = 37 } = {}) {
  const g = group();
  const S = height / 5.6;
  const parts = [];
  const dark = new THREE.Color(fleece).offsetHSL(0, 0.02, -0.16).getHex();

  const body = taperedTube(
    [[0, 3.3 * S, -1.5 * S], [0, 3.5 * S, -0.6 * S], [0, 3.5 * S, 0.5 * S], [0, 3.35 * S, 1.25 * S]],
    [0.4 * S, 0.72 * S, 0.72 * S, 0.5 * S],
    { tubularSegments: 14, radialSegments: 12 },
  );
  body.scale(0.82, 1, 1);
  parts.push({ geometry: body, color: fleece });

  // Legs. Long, thin and straight, with a visible knee bulge -- a llama's legs are most of
  // its height, and short ones turn it into a sheep instantly.
  for (const [lx, lz] of [[-0.42 * S, -1.15 * S], [0.42 * S, -1.15 * S], [-0.42 * S, 0.95 * S], [0.42 * S, 0.95 * S]]) {
    parts.push({
      geometry: taperedTube(
        [[lx, 0.12 * S, lz], [lx, 1.5 * S, lz + 0.05 * S], [lx, 2.95 * S, lz]],
        [0.1 * S, 0.13 * S, 0.24 * S], { tubularSegments: 8, radialSegments: 9 },
      ),
      color: fleece,
    });
    parts.push({ geometry: new THREE.SphereGeometry(0.13 * S, 8, 6), color: dark, position: [lx, 0.13 * S, lz] });
  }

  // The neck: upright, and long enough that the head clears the back by a full body depth.
  const neck = taperedTube(
    [[0, 3.5 * S, 1.1 * S], [0, 4.3 * S, 1.5 * S], [0, 5.05 * S, 1.5 * S]],
    [0.34 * S, 0.24 * S, 0.2 * S], { tubularSegments: 10, radialSegments: 10 },
  );
  parts.push({ geometry: neck, color: fleece });

  // Head: a short wedge, not a ball.
  const head = new THREE.SphereGeometry(0.26 * S, 12, 9);
  head.scale(0.8, 0.95, 1.3);
  parts.push({ geometry: head, color: fleece, position: [0, 5.28 * S, 1.62 * S] });
  parts.push({ geometry: new THREE.SphereGeometry(0.16 * S, 10, 8), color: dark, position: [0, 5.18 * S, 1.95 * S] });
  // Ears -- long, and curving toward each other. This is the field mark.
  for (const side of [-1, 1]) {
    const ear = new THREE.CylinderGeometry(0.02 * S, 0.075 * S, 0.52 * S, 7);
    parts.push({ geometry: ear, color: fleece, position: [side * 0.15 * S, 5.66 * S, 1.5 * S], rotation: [-0.12, 0, side * -0.34] });
  }
  for (const side of [-1, 1]) {
    parts.push({ geometry: new THREE.SphereGeometry(0.055 * S, 8, 6), color: 0x2a231c, position: [side * 0.19 * S, 5.34 * S, 1.78 * S] });
  }
  // A short tail, held up.
  parts.push({
    geometry: taperedTube([[0, 3.35 * S, -1.5 * S], [0, 3.55 * S, -1.85 * S], [0, 3.4 * S, -2.05 * S]], [0.13 * S, 0.09 * S, 0.04 * S],
      { tubularSegments: 6, radialSegments: 8 }),
    color: fleece,
  });

  g.add(mergedMesh(parts, { roughness: 0.98, ...relief('weave', { seed, repeat: 5 }) }));
  return g;
}

