// Native HiFi models, substituted for a main-app prop by its PROP_BUILDERS key.
//
// The bridge can mirror any main-app prop as it stands, and for most of the five hundred that
// is the right answer: the geometry is already detailed and PBR lighting is what it lacked.
// But the things a student stands next to in EVERY world -- trees, benches, lamp posts, signs,
// planters -- were built to a Chromebook's budget, and those are rebuilt here from scratch.
// When a record's prop key is in this table the three.js object is kept (it is what gets
// clicked, measured and programmed) and drawn as the native model instead.
//
// A native builder takes the SAME options the main-app builder takes, stands on the same
// origin and faces the same way, so a world file needs no changes to pick it up.

import { TransformNode, Vector3, Quaternion } from '@babylonjs/core';
import * as Common from './Common.js';
import * as Park from './Park.js';
import * as Trees from './Trees.js';
import * as Flora from './Flora.js';
import * as Regolith from './Regolith.js';
import { LUNAR_NATIVE } from './Lunar.js';
import { MARTIAN_NATIVE } from './Martian.js';
import * as Turkle from './Turkle.js';

export const NATIVE = {
  'shade-tree': Trees.shadeTree,
  'conifer-tree': Trees.coniferTree,
  'flowering-tree': Trees.floweringTree,
  'bench': Common.bench,
  'lamp-post': Common.lampPost,
  'planter': Common.planter,
  'drinking-fountain': Common.drinkingFountain,
  'park-gate': Park.parkGate,
  'nature-centre': Park.natureCentre,
  'stone-fountain': Park.stoneFountain,
  'park-pond': Park.parkPond,
  'pond-geese': Park.pondGeese,
  'canada-goose': Park.canadaGoose,
  'picnic-set': Park.picnicSet,
  'puddingstone-outcrop': Park.puddingstoneOutcrop,
  'flower-bed': Park.flowerBed,
  'wildflowers': Park.wildflowers,

  // Dinosaur Island: the Cretaceous flora.
  'araucaria-tree': Flora.araucariaTree,
  'tree-fern': Flora.treeFern,
  'cycad': Flora.cycad,
  'fern-patch': Flora.fernPatch,
  'horsetail-patch': Flora.horsetailPatch,
  'ginkgo-tree': Trees.ginkgoTree,
  'magnolia-shrub': Trees.magnoliaShrub,
  // Machu Picchu: high-Andean scrub.
  'polylepis-tree': Trees.polylepisTree,
  'ichu-grass': Flora.ichuGrass,
  'andean-flowers': Park.wildflowers,
  // A Rabbit's Den: the hedgerow.
  'hawthorn-tree': Trees.hawthornTree,
  'bramble-thicket': Flora.brambleThicket,
  'meadow-clump': Flora.meadowClump,
  'meadow-flowers': Park.wildflowers,
  // The Neighborhood: street trees and clipped hedges.
  'nb-tree': Flora.nbTree,
  'nb-conifer': Flora.nbConifer,
  'nb-hedge': Flora.nbHedge,

  // TURKLE STREET IS NATIVE END TO END, which no other world is. Everywhere else the table
  // picks out the handful of props a student stands next to and leaves the rest to the
  // bridge; here the world was laid out for this edition and every single key in it has a
  // model below. A mirrored three.js house on this street would be the one object that gave
  // the game away.
  'ts-street': Turkle.street,
  'ts-driveway': Turkle.driveway,
  'ts-walk': Turkle.walk,
  'ts-ranch-house': Turkle.ranchHouse,
  'ts-garage': Turkle.garage,
  'ts-neighbor-house': Turkle.neighborHouse,
  'ts-privacy-fence': Turkle.privacyFence,
  'ts-chain-fence': Turkle.chainFence,
  'ts-utility-pole': Turkle.utilityPole,
  'ts-street-sign': Turkle.streetSign,
  'ts-mailbox': Turkle.mailbox,
  'ts-ac-unit': Turkle.acUnit,
  'ts-trash-cart': Turkle.trashCart,
  'ts-pumpkin': Turkle.pumpkin,
  'ts-mulch-ring': Turkle.mulchRing,
  'ts-foundation-bed': Turkle.foundationBed,
  'ts-leaf-drift': Turkle.leafDrift,
  'ts-street-tree': Turkle.streetTree,
  'ts-shrub': Turkle.turkleShrub,

  // The Moon and Mars: the ground furniture here, the hardware in its own two files.
  ...Regolith.REGOLITH_NATIVE,
  ...LUNAR_NATIVE,
  ...MARTIAN_NATIVE,
};

// TREES ARE QUANTISED. A layout gives nearly every tree its own height and seed, which is right
// for the main app and would mean a separate 12k-triangle template for each of the forty street
// trees in The Neighborhood. Heights snap to the nearest 4ft and seeds fold to three variants,
// so a whole world's trees are a dozen templates hardware-instanced -- and the instance is then
// scaled by wanted/snapped, so every tree still stands exactly as tall as its record says.
const TREE_DEFAULT_HEIGHT = {
  'shade-tree': 22, 'conifer-tree': 24, 'flowering-tree': 16, 'araucaria-tree': 40, 'tree-fern': 14, 'cycad': 6,
  'ginkgo-tree': 26, 'magnolia-shrub': 9, 'polylepis-tree': 13, 'hawthorn-tree': 22, 'nb-tree': 24, 'nb-conifer': 20,
  'ts-street-tree': 38,
};
function quantiseTree(key, options) {
  const dflt = TREE_DEFAULT_HEIGHT[key];
  if (!dflt) return { options, scale: 1 };
  const h = options.height ?? dflt;
  const step = h < 12 ? 2 : 4;
  const q = Math.max(step, Math.round(h / step) * step);
  return { options: { ...options, height: q, seed: Math.abs(Math.round(options.seed ?? 0)) % 3 }, scale: h / q };
}

// Record kinds (not props) with a native stand-in. `fit: true` means the three object is a
// loaded FILE of arbitrary scale and pivot, so the native model is fitted to its bounds: same
// height, same base, same centre -- whatever scale the record left on the root.
const NATIVE_KINDS = {
  'startup-tree': { key: 'maple-tree', build: Trees.mapleTree, fit: true, options: (h) => ({ height: Math.max(12, Math.round(h / 3) * 3), seed: 1 }) },
};

export class Natives {
  constructor({ scene, kit, pipeline, lights, water, enabled = true }) {
    Object.assign(this, { scene, kit, pipeline, lights, water, enabled });
    this.templates = new Map();
    this.nightHooks = new Set();
    this.tickers = new Set();
    this.footprints = new Map(); // node -> footprint
    this.theme = null;
  }

  resolve(presetName, record, three) {
    if (!this.enabled) return null;
    if (presetName && NATIVE[presetName]) {
      const { options, scale } = quantiseTree(presetName, record?.options ?? {});
      return { key: presetName, build: NATIVE[presetName], options, scale };
    }
    const kind = record && three.userData?.placedId ? NATIVE_KINDS[record.kind] : null;
    if (kind) {
      const bounds = localBounds(three);
      if (!bounds) return null;
      const worldHeight = (bounds.max[1] - bounds.min[1]) * three.scale.y;
      return { key: kind.key, build: kind.build, options: kind.options(worldHeight), fit: { bounds, worldHeight } };
    }
    return null;
  }

  // Builds (or instances) the native model under `parent`, which the bridge keeps in step
  // with the three object. Returns a handle the bridge disposes with the object.
  build(native, parent, three) {
    const ctx = { water: this.water, theme: this.theme };
    let root;
    const cacheable = true;
    const key = `${native.key}:${JSON.stringify(native.options)}`;
    try {
      if (cacheable && this.templates.has(key)) root = this.instantiate(this.templates.get(key));
      else {
        root = native.build(this.kit, native.options, ctx, three);
        if (cacheable && root.metadata?.instanceable !== false) {
          this.templates.set(key, root);
          this.attachLOD(root);
          const template = root;
          root = this.instantiate(template);
          for (const m of template.getChildMeshes()) m.isVisible = false;
        }
      }
    } catch (err) {
      console.error(`native prop "${native.key}" failed; mirroring the original instead`, err);
      return null;
    }
    root.parent = parent;
    if (native.scale && native.scale !== 1) root.scaling.setAll(native.scale);
    if (native.fit) {
      // `parent` carries the three root's own scale; undo it, then size to the real height.
      const { bounds, worldHeight } = native.fit;
      const k = worldHeight / native.options.height / (three.scale.y || 1);
      root.scaling.setAll(k);
      root.position.set((bounds.min[0] + bounds.max[0]) / 2, bounds.min[1], (bounds.min[2] + bounds.max[2]) / 2);
    }
    const meta = root.metadata ?? {};
    for (const m of meta.casters ?? []) this.pipeline.addCaster(m);
    const lights = [];
    for (const l of meta.lights ?? []) {
      const light = this.lights.add(new Vector3(), l);
      light.parent = parent;
      light.position.set(l.pos[0], l.pos[1], l.pos[2]);
      lights.push(light);
    }
    for (const hook of meta.nightLights ?? []) { this.nightHooks.add(hook); hook(this.lights.night); }
    if (meta.tick) this.tickers.add(meta.tick);
    if (meta.footprint) this.footprints.set(parent, meta.footprint);
    return {
      root,
      dispose: () => {
        for (const m of meta.casters ?? []) this.pipeline.removeCaster(m);
        for (const l of lights) this.lights.remove(l);
        if (meta.tick) this.tickers.delete(meta.tick);
        this.footprints.delete(parent);
        root.dispose(false, false);
      },
    };
  }

  instantiate(template) {
    const root = new TransformNode(template.name, this.scene);
    const casters = [];
    const templateCasters = new Set(template.metadata?.casters ?? []);
    for (const mesh of template.getChildMeshes()) {
      if (mesh.metadata?.isLOD) continue;
      const inst = mesh.createInstance(`${mesh.name}#`);
      inst.parent = root;
      // The template sits at the origin and is never moved, so a child's WORLD matrix is its
      // offset under the template, however many nodes deep it is parented.
      const s = new Vector3(); const q = new Quaternion(); const t = new Vector3();
      mesh.computeWorldMatrix(true).decompose(s, q, t);
      inst.position.copyFrom(t); inst.rotationQuaternion = q; inst.scaling.copyFrom(s);
      inst.isPickable = false;
      if (templateCasters.has(mesh)) casters.push(inst);
    }
    const m = template.metadata ?? {};
    root.metadata = { casters, lights: m.lights, nightLights: m.nightLights, footprint: m.footprint };
    return root;
  }

  // A template may carry a cheaper twin in metadata.lod, built from the same seed. Registered
  // on the SOURCE mesh, it is inherited by every hardware instance of it.
  attachLOD(template) {
    const low = template.metadata?.lod;
    if (!low) return;
    const hi = template.getChildMeshes(); const lo = low.getChildMeshes();
    const dist = this.kit.quality.lodDistance ?? 240;
    hi.forEach((mesh, i) => { if (lo[i]) { lo[i].metadata = { ...(lo[i].metadata || {}), isLOD: true }; mesh.addLODLevel(dist, lo[i]); } });
  }

  setNight(amount) { for (const hook of this.nightHooks) hook(amount); }
  update(dt) { for (const t of this.tickers) t(dt); }
  setTheme(theme) { this.theme = theme; }
}

// Bounds of a three object in its OWN root frame (before the root's scale).
function localBounds(three) {
  const min = [Infinity, Infinity, Infinity]; const max = [-Infinity, -Infinity, -Infinity];
  three.updateMatrixWorld(true);
  const inv = three.matrixWorld.clone().invert();
  three.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld).applyMatrix4(inv);
    for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], b.min.getComponent(i)); max[i] = Math.max(max[i], b.max.getComponent(i)); }
  });
  return Number.isFinite(max[1] - min[1]) && max[1] > min[1] ? { min, max } : null;
}
