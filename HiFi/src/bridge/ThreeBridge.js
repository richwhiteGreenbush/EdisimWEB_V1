// three.js as the scene graph, Babylon as the renderer.
//
// Edusim's own logic -- the record pipeline, five hundred prop builders, the block and
// JavaScript runtimes, Create Model, Draw, duplication, persistence -- is written against a
// three.js scene, and every one of those classes takes its `scene`, `camera` and `canvas` by
// injection. None of them needs a three.js RENDERER. So HiFi runs all of it unchanged against
// a three scene that is never drawn, and this file mirrors that scene into Babylon every
// frame. Rewriting a hundred thousand lines against a second engine would produce a second
// app that drifts from the first the day it ships; mirroring produces one app with two
// renderers, and a world fixed in one is fixed in both.
//
// What the mirror does, each frame:
//   * walks the three tree; builds a Babylon node for anything new, disposes anything gone;
//   * copies LOCAL transforms and visibility (the hierarchy is mirrored, so local is right);
//   * re-reads the handful of material fields a program can change (colour, opacity,
//     emissive) and re-uploads any texture or geometry whose three `version` moved -- which
//     is how an animated GIF, a growing marker stroke and a recoloured robot all just work.
//
// What it does on the way across is the "HiFi" half: MeshStandardMaterial becomes a PBR
// material lit by the sky probe, greyscale bump maps become real normal maps, point lights
// join the clustered light container, casters join the cascaded shadow maps, and any prop
// with a native HiFi model (see props/native.js) is SUBSTITUTED rather than mirrored.

import * as THREE from 'three';
import {
  Mesh, VertexData, VertexBuffer, TransformNode, PBRMaterial, DynamicTexture, Texture, Color3, Material, MultiMaterial,
  SubMesh, MeshBuilder, Constants, Vector3, Quaternion,
} from '@babylonjs/core';

const SIDE_FRONT = 0; const SIDE_BACK = 1; const SIDE_DOUBLE = 2;
const WRAP = { 1000: Texture.WRAP_ADDRESSMODE, 1001: Texture.CLAMP_ADDRESSMODE, 1002: Texture.MIRROR_ADDRESSMODE };
const MAX_TEXTURE = 2048;
const TEXTURE_SLOTS = [['map', 'color'], ['emissiveMap', 'color'], ['bumpMap', 'bump'], ['normalMap', 'data'], ['alphaMap', 'data']];
// Unlit output still goes through ACES tone mapping, which lifts mid-tones and rolls off the
// top; 0.82 lands paper-white just under the bloom threshold and keeps dark type dark.
const SIGN_BRIGHTNESS = 0.82;
const SWEEP_AFTER = 600; // frames a material or texture may go unused before it is freed

export class ThreeBridge {
  constructor({ scene, threeScene, pipeline, lights, natives, registry, ignore = [] }) {
    Object.assign(this, { scene, threeScene, pipeline, lights, natives, registry });
    this.ignore = new Set(ignore);
    this.nodes = new Map(); // three Object3D -> entry
    this.materials = new Map(); // three Material -> { mat, sig }
    this.textures = new Map(); // `${uuid}:${role}` -> { tex, version, source }
    this.frame = 0;
    this.structureVersion = 0; // bumps whenever something is added or removed
    this.root = new TransformNode('three-mirror', scene);
    // Main-app signs carry an emissive lift so they stay legible under ITS lighting, where
    // nothing else brightens a shaded face. Under HiFi's far brighter sun plus bloom the same
    // lift clips a daylit board to white, so it is scaled back by day and left alone in the
    // worlds that are dark by design, where it is the only thing lighting the type.
    this.emissiveScale = 1;
    // How bright an unlit sign face is drawn. Lower in worlds that are dark by design: against a
    // black sky a paper-white placard at daylight strength is the brightest thing in the frame,
    // blooms, and at any distance mips to a featureless white rectangle.
    this.signBrightness = SIGN_BRIGHTNESS;
  }

  // ---- per-frame --------------------------------------------------------------------------
  sync() {
    this.frame++;
    this.threeScene.updateMatrixWorld();
    for (const child of this.threeScene.children) this.visit(child, this.root);
    for (const [obj, entry] of this.nodes) {
      if (entry.stamp !== this.frame) this.drop(obj, entry);
    }
    this.syncMaterials();
  }

  visit(obj, parentNode) {
    if (this.ignore.has(obj) || obj.isLight && !obj.isPointLight || obj.isCamera) return;
    let entry = this.nodes.get(obj);
    if (!entry) {
      entry = this.create(obj, parentNode);
      if (!entry) return;
      this.nodes.set(obj, entry);
      this.structureVersion++;
    }
    entry.stamp = this.frame;
    const node = entry.node;
    if (entry.parentNode !== parentNode && node) { node.parent = parentNode; entry.parentNode = parentNode; }

    if (node) {
      const p = obj.position; const q = obj.quaternion; const s = obj.scale;
      node.position.set(p.x, p.y, p.z);
      node.rotationQuaternion.set(q.x, q.y, q.z, q.w);
      node.scaling.set(s.x, s.y, s.z);
      if (entry.visible !== obj.visible) { node.setEnabled(obj.visible); entry.visible = obj.visible; }
    }
    if (entry.light) {
      obj.getWorldPosition(_v);
      entry.light.position.set(_v.x, _v.y, _v.z);
    }
    if (entry.mesh) this.refreshMesh(obj, entry);
    // Mark this object's materials as LIVE, every frame. The sweep in syncMaterials() disposes
    // anything that has gone unstamped for ten seconds, and stamping only at assignment meant
    // that ten seconds after a world loaded every mirrored material in it was destroyed while
    // its mesh was still using it -- models went black and emissive signs went white.
    if (obj.material) this.touch(obj.material);
    if (entry.native) return; // a substituted prop: its three children are picking geometry only
    for (const child of obj.children) this.visit(child, node ?? parentNode);
  }

  drop(obj, entry) {
    this.nodes.delete(obj);
    this.structureVersion++;
    if (entry.light) this.lights.remove(entry.light);
    if (entry.casters) for (const m of entry.casters) this.pipeline.removeCaster(m);
    if (entry.native?.dispose) entry.native.dispose();
    entry.ownMaterial?.dispose(false, false);
    // Geometry is owned by the mirror; materials and textures are shared and swept separately.
    entry.node?.dispose(true, false);
  }

  // ---- creation -----------------------------------------------------------------------------
  create(obj, parentNode) {
    if (obj.isPointLight) {
      const light = this.lights.add(new Vector3(), {
        color: obj.color.getHex(), intensity: obj.intensity * 38, range: Math.max(18, (obj.distance || 16) * 2.2), always: 1,
      }, true);
      return { node: null, light, parentNode };
    }

    let node;
    const entry = { parentNode, visible: true };
    const presetName = obj.userData?.presetProp;
    const record = obj.userData?.placedId ? this.registry?.items.get(obj.userData.placedId)?.record : null;
    const native = this.natives?.resolve(presetName, record, obj);

    if (native) {
      node = new TransformNode(`native:${native.key}`, this.scene);
      node.rotationQuaternion = new Quaternion();
      entry.native = this.natives.build(native, node, obj);
    } else if (obj.isSprite) {
      node = this.createSprite(obj, entry);
    } else if (obj.isMesh) {
      node = this.createMesh(obj, entry);
    } else if (obj.isPoints) {
      node = this.createPoints(obj, entry);
    } else if (obj.isLine) {
      node = this.createLine(obj, entry);
    } else {
      node = new TransformNode(obj.name || obj.type, this.scene);
    }
    if (!node) return null;
    if (!node.rotationQuaternion) node.rotationQuaternion = new Quaternion();
    node.parent = parentNode;
    node.metadata = { ...(node.metadata || {}), three: obj };
    entry.node = node;
    return entry;
  }

  geometryData(geometry, flat) {
    const pos = geometry.attributes.position;
    if (!pos) return null;
    let g = geometry;
    if (flat && g.index) g = g.toNonIndexed();
    const vd = new VertexData();
    vd.positions = attrArray(g.attributes.position, 3);
    if (flat) {
      // three's flatShading is a derivative trick in the fragment shader; here it is geometry.
      const n = new Float32Array(vd.positions.length);
      for (let i = 0; i < n.length; i += 9) {
        const ax = vd.positions[i + 3] - vd.positions[i]; const ay = vd.positions[i + 4] - vd.positions[i + 1]; const az = vd.positions[i + 5] - vd.positions[i + 2];
        const bx = vd.positions[i + 6] - vd.positions[i]; const by = vd.positions[i + 7] - vd.positions[i + 1]; const bz = vd.positions[i + 8] - vd.positions[i + 2];
        let nx = ay * bz - az * by; let ny = az * bx - ax * bz; let nz = ax * by - ay * bx;
        const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
        for (let k = 0; k < 9; k += 3) { n[i + k] = nx; n[i + k + 1] = ny; n[i + k + 2] = nz; }
      }
      vd.normals = n;
    } else if (g.attributes.normal) vd.normals = attrArray(g.attributes.normal, 3);
    if (g.attributes.uv) vd.uvs = attrArray(g.attributes.uv, 2);
    if (g.attributes.color) {
      const c = g.attributes.color; const src = attrArray(c, c.itemSize);
      if (c.itemSize === 4) vd.colors = src;
      else { const out = new Float32Array((src.length / 3) * 4); for (let i = 0, j = 0; i < src.length; i += 3, j += 4) { out[j] = src[i]; out[j + 1] = src[i + 1]; out[j + 2] = src[i + 2]; out[j + 3] = 1; } vd.colors = out; }
    }
    const count = vd.positions.length / 3;
    if (g.index) vd.indices = g.index.array;
    else { const idx = count > 65535 ? new Uint32Array(count) : new Uint16Array(count); for (let i = 0; i < count; i++) idx[i] = i; vd.indices = idx; }
    if (!vd.normals) { const n = []; VertexData.ComputeNormals(vd.positions, vd.indices, n, { useRightHandedSystem: true }); vd.normals = n; }
    return vd;
  }

  createMesh(obj, entry) {
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const flat = mats.some((m) => m?.flatShading);
    const dynamic = obj.geometry.attributes.position?.usage === THREE.DynamicDrawUsage || obj.geometry.drawRange.count !== Infinity;
    const vd = this.geometryData(obj.geometry, flat);
    if (!vd) return new TransformNode(obj.name || 'empty', this.scene);
    const mesh = new Mesh(obj.name || 'mesh', this.scene);
    vd.applyToMesh(mesh, dynamic);
    mesh.isPickable = false; // picking stays on the three side, against the real geometry
    mesh.receiveShadows = !!obj.receiveShadow;
    mesh.useVertexColors = mats.some((m) => m?.vertexColors);
    mesh.hasVertexAlpha = false;
    if (obj.renderOrder) mesh.alphaIndex = obj.renderOrder;
    this.assignMaterial(mesh, obj, mats);
    const transparent = mats.every((m) => m && (m.transparent && m.opacity < 0.98 || m.isMeshBasicMaterial && m.blending === THREE.AdditiveBlending));
    if (obj.castShadow && !transparent) { this.pipeline.addCaster(mesh); entry.casters = [mesh]; }
    entry.mesh = mesh;
    entry.geometry = obj.geometry;
    entry.material = obj.material;
    entry.flat = flat;
    entry.versions = geometryVersions(obj.geometry);
    this.applyDrawRange(mesh, obj.geometry);
    return mesh;
  }

  assignMaterial(mesh, obj, mats) {
    if (mats.length === 1) { mesh.material = this.material(mats[0]); return; }
    const multi = new MultiMaterial('multi', this.scene);
    for (const m of mats) multi.subMaterials.push(this.material(m));
    mesh.material = multi;
    const groups = obj.geometry.groups;
    if (groups.length) {
      mesh.subMeshes = [];
      const verts = mesh.getTotalVertices();
      for (const g of groups) new SubMesh(g.materialIndex ?? 0, 0, verts, g.start, g.count, mesh);
    }
  }

  applyDrawRange(mesh, geometry) {
    const dr = geometry.drawRange;
    if (dr.count === Infinity || !mesh.subMeshes?.length || mesh.subMeshes.length > 1) return;
    const sm = mesh.subMeshes[0];
    sm.indexStart = dr.start; sm.indexCount = Math.max(0, Math.min(dr.count, mesh.getTotalIndices() - dr.start));
  }

  refreshMesh(obj, entry) {
    if (obj.geometry !== entry.geometry) {
      // A different geometry object altogether (a re-inflated balloon, a swapped shape).
      const vd = this.geometryData(obj.geometry, entry.flat);
      if (vd) vd.applyToMesh(entry.mesh, true);
      entry.geometry = obj.geometry; entry.versions = geometryVersions(obj.geometry);
    } else {
      const v = geometryVersions(obj.geometry);
      if (v !== entry.versions) {
        entry.versions = v;
        const g = obj.geometry;
        if (!entry.flat) {
          entry.mesh.setVerticesData(VertexBuffer.PositionKind, attrArray(g.attributes.position, 3), true);
          if (g.attributes.normal) entry.mesh.setVerticesData(VertexBuffer.NormalKind, attrArray(g.attributes.normal, 3), true);
          if (g.attributes.color && g.attributes.color.itemSize === 3) entry.mesh.setVerticesData(VertexBuffer.ColorKind, attrArray(g.attributes.color, 3), true, 3);
          entry.mesh.refreshBoundingInfo();
        } else {
          const vd = this.geometryData(g, true); if (vd) vd.applyToMesh(entry.mesh, true);
        }
        this.applyDrawRange(entry.mesh, g);
      }
    }
    if (obj.material !== entry.material) {
      entry.material = obj.material;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      entry.mesh.useVertexColors = mats.some((m) => m?.vertexColors);
      this.assignMaterial(entry.mesh, obj, mats);
    }
  }

  createSprite(obj, entry) {
    // A THREE.Sprite is a unit quad that always faces the camera, sized by its scale.
    const mesh = MeshBuilder.CreatePlane('sprite', { size: 1 }, this.scene);
    mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
    mesh.isPickable = false;
    mesh.material = this.material(obj.material);
    mesh.renderingGroupId = obj.material?.depthTest === false ? 1 : 0;
    mesh.applyFog = false;
    entry.sprite = true;
    return mesh;
  }

  createPoints(obj, entry) {
    const vd = this.geometryData(obj.geometry, false);
    if (!vd) return null;
    const mesh = new Mesh(obj.name || 'points', this.scene);
    vd.applyToMesh(mesh, false);
    mesh.isPickable = false;
    mesh.useVertexColors = !!obj.material?.vertexColors;
    const mat = this.material(obj.material).clone('points');
    mat.pointsCloud = true;
    mat.pointSize = Math.max(1.5, Math.min(6, (obj.material?.size ?? 1) * 2.2));
    mesh.material = mat;
    entry.ownMaterial = mat;
    return mesh;
  }

  createLine(obj) {
    const pos = obj.geometry.attributes.position;
    if (!pos) return null;
    const pts = [];
    for (let i = 0; i < pos.count; i++) pts.push(new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
    let lines;
    if (obj.isLineSegments) {
      const segs = []; for (let i = 0; i + 1 < pts.length; i += 2) segs.push([pts[i], pts[i + 1]]);
      lines = MeshBuilder.CreateLineSystem(obj.name || 'lines', { lines: segs }, this.scene);
    } else lines = MeshBuilder.CreateLines(obj.name || 'line', { points: pts }, this.scene);
    const c = obj.material?.color;
    if (c) lines.color = new Color3(c.r, c.g, c.b);
    lines.isPickable = false;
    return lines;
  }

  // ---- materials ------------------------------------------------------------------------------
  touch(m) {
    if (Array.isArray(m)) { for (const x of m) this.touch(x); return; }
    const rec = this.materials.get(m);
    if (!rec) return;
    rec.stamp = this.frame;
    // ...and its textures, which are swept on the same clock. Without a sweep every world
    // visited leaves its sign canvases behind on the GPU, at up to 16MB apiece.
    for (const [slot, role] of TEXTURE_SLOTS) {
      const t = m[slot];
      if (t) { const tr = this.textures.get(`${t.uuid}:${role}`); if (tr) tr.stamp = this.frame; }
    }
  }

  material(m) {
    if (!m) return null;
    let rec = this.materials.get(m);
    if (!rec) { rec = { mat: this.convertMaterial(m), sig: '' }; this.materials.set(m, rec); }
    rec.stamp = this.frame;
    return rec.mat;
  }

  convertMaterial(m) {
    const mat = new PBRMaterial(m.name || m.type, this.scene);
    // A SIGN FACE is a material whose colour map is ALSO its emissive map: every activity board,
    // welcome board, tutorial board, placard and star chart in the main app is built that way,
    // so that type stays legible on a shaded face under that app's lighting. Carried across as
    // lit-plus-emissive it is wrong at every hour here: by day the lift stacks on full sunlight
    // and bloom and the glow layer smear it into a milky, low-contrast panel; at dusk the lit
    // half goes dark and only the glow is left. A sign is for READING, so it is drawn UNLIT at
    // one fixed brightness -- the artwork's own colours, whatever the sun is doing -- which also
    // keeps it out of the glow layer (no emissive) and under the bloom threshold.
    const sign = !!m.emissiveMap && m.emissiveMap === m.map;
    const unlit = sign || m.isMeshBasicMaterial || m.isSpriteMaterial || m.isPointsMaterial || m.isLineBasicMaterial || m.isShaderMaterial;
    mat.unlit = unlit;
    mat.metadata = { sign };
    mat.metallic = unlit ? 0 : (m.metalness ?? 0);
    mat.roughness = unlit ? 1 : (m.roughness ?? 1);
    // Main-app materials were tuned with NO environment map, so anything shiny there was
    // deliberately held back. Under image-based lighting they can simply be what they are.
    mat.environmentIntensity = 1;
    // DoubleSide still needs its winding stated. With culling off Babylon decides which face
    // is the BACK one -- the one whose normal it flips for two-sided lighting -- from
    // sideOrientation, and left at the default it picks three's front: every double-sided
    // surface in every world is then lit from behind, and a cream sign board renders black.
    if (m.side === SIDE_DOUBLE) { mat.backFaceCulling = false; mat.twoSidedLighting = true; mat.sideOrientation = Material.CounterClockWiseSideOrientation; }
    else { mat.backFaceCulling = true; mat.sideOrientation = m.side === SIDE_BACK ? Material.ClockWiseSideOrientation : Material.CounterClockWiseSideOrientation; }
    if (m.isSpriteMaterial) { mat.backFaceCulling = false; }
    if (m.depthWrite === false) mat.disableDepthWrite = true;
    if (m.depthTest === false) mat.depthFunction = Constants.ALWAYS;
    if (m.fog === false) mat.fogEnabled = false;
    if (m.blending === THREE.AdditiveBlending) { mat.alphaMode = Constants.ALPHA_ADD; mat.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND; mat.disableDepthWrite = true; }
    this.updateMaterial(m, mat, true);
    return mat;
  }

  // Re-reads the fields a running program or an edit can change. Cheap enough to do for every
  // live material every frame: a signature string is compared and nothing is touched on a match.
  updateMaterial(m, mat, force = false) {
    const c = m.color; const e = m.emissive;
    const sig = `${c ? c.getHex() : 0}|${m.opacity}|${m.transparent}|${e ? e.getHex() : 0}|${m.emissiveIntensity ?? 1}|${m.map?.uuid}|${m.map?.version}|${m.emissiveMap?.version}|${m.bumpMap?.version}|${m.visible}`;
    const rec = this.materials.get(m);
    if (!force && rec && rec.sig === sig) return;
    if (rec) rec.sig = sig;
    const sign = mat.metadata?.sign;
    if (c) { const k = sign ? this.signBrightness : 1; mat.albedoColor.set(c.r * k, c.g * k, c.b * k); }
    if (e && !sign) { const k = (m.emissiveIntensity ?? 1) * (m.userData?.isGlow ? 1 : this.emissiveScale); mat.emissiveColor.set(e.r * k, e.g * k, e.b * k); }
    const map = m.map ? this.texture(m.map, 'color') : null;
    mat.albedoTexture = map;
    if (m.emissiveMap && !sign) { mat.emissiveTexture = this.texture(m.emissiveMap, 'color'); }
    if (m.normalMap) mat.bumpTexture = this.texture(m.normalMap, 'data');
    else if (m.bumpMap) { mat.bumpTexture = this.texture(m.bumpMap, 'bump'); if (mat.bumpTexture) mat.bumpTexture.level = Math.min(2.2, 0.55 + (m.bumpScale ?? 1) * 0.6); }
    if (m.alphaMap) { mat.opacityTexture = this.texture(m.alphaMap, 'data'); if (mat.opacityTexture) mat.opacityTexture.getAlphaFromRGB = true; }

    const additive = m.blending === THREE.AdditiveBlending;
    mat.alpha = m.opacity ?? 1;
    if (additive) { if (map) { map.hasAlpha = true; mat.useAlphaFromAlbedoTexture = true; } }
    else if (m.alphaTest > 0) { mat.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST; mat.alphaCutOff = m.alphaTest; if (map) { map.hasAlpha = true; mat.useAlphaFromAlbedoTexture = true; } }
    else if (m.transparent) { mat.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND; if (map) { map.hasAlpha = true; mat.useAlphaFromAlbedoTexture = true; } }
    else mat.transparencyMode = PBRMaterial.PBRMATERIAL_OPAQUE;
  }

  syncMaterials() {
    for (const [m, rec] of this.materials) {
      if (this.frame - rec.stamp > SWEEP_AFTER) { rec.mat.dispose(false, false); this.materials.delete(m); continue; }
      this.updateMaterial(m, rec.mat);
    }
    // Textures whose three `version` moved: an animated GIF's frame, a photo that finished
    // loading behind its 1x1 placeholder, a canvas a tool repainted.
    for (const [key, t] of this.textures) {
      if (this.frame - (t.stamp ?? this.frame) > SWEEP_AFTER) { t.tex?.dispose(); this.textures.delete(key); continue; }
      if (t.source.version !== t.version) this.uploadTexture(t, key);
    }
  }

  // ---- textures ---------------------------------------------------------------------------------
  texture(t, role) {
    const key = `${t.uuid}:${role}`;
    let rec = this.textures.get(key);
    if (!rec) {
      rec = { source: t, role, version: -1, tex: null, stamp: this.frame };
      this.textures.set(key, rec);
      this.uploadTexture(rec, key);
    }
    return rec.tex;
  }

  uploadTexture(rec) {
    const t = rec.source; const img = t.image;
    rec.version = t.version;
    const w = img?.width || img?.videoWidth || 0; const h = img?.height || img?.videoHeight || 0;
    if (!img || !w || !h) return;
    const scale = Math.min(1, MAX_TEXTURE / Math.max(w, h));
    const tw = Math.max(1, Math.round(w * scale)); const th = Math.max(1, Math.round(h * scale));
    const needNew = !rec.tex || rec.w !== tw || rec.h !== th;
    if (needNew) {
      const old = rec.tex;
      rec.tex = new DynamicTexture(`three:${rec.role}`, { width: tw, height: th }, this.scene, true);
      rec.w = tw; rec.h = th;
      rec.tex.anisotropicFilteringLevel = 16;
      // Re-point every material at the replacement before the old one goes.
      if (old) { for (const [m, mr] of this.materials) mr.sig = ''; old.dispose(); }
    }
    const tex = rec.tex;
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, tw, th);
    try { ctx.drawImage(img, 0, 0, tw, th); } catch { return; }
    if (rec.role === 'bump') heightToNormal(ctx, tw, th);
    tex.gammaSpace = rec.role === 'color' && t.colorSpace !== '' && t.colorSpace !== 'srgb-linear';
    tex.wrapU = WRAP[t.wrapS] ?? Texture.CLAMP_ADDRESSMODE;
    tex.wrapV = WRAP[t.wrapT] ?? Texture.CLAMP_ADDRESSMODE;
    // three maps uv -> uv * repeat + offset about the ORIGIN; Babylon scales about its rotation
    // centre (0.5) unless told otherwise, which shifts every tiled overlay by half a tile.
    tex.uRotationCenter = 0; tex.vRotationCenter = 0;
    tex.uScale = t.repeat.x; tex.vScale = t.repeat.y; tex.uOffset = t.offset.x; tex.vOffset = t.offset.y;
    tex.update(t.flipY !== false);
  }

  setEmissiveScale(k, signBrightness = SIGN_BRIGHTNESS) {
    if (k === this.emissiveScale && signBrightness === this.signBrightness) return;
    this.emissiveScale = k;
    this.signBrightness = signBrightness;
    for (const rec of this.materials.values()) rec.sig = '';
  }

  // Every mirrored mesh that belongs to the placed object with this three root.
  meshesUnder(obj) {
    const out = [];
    obj.traverse((o) => { const e = this.nodes.get(o); if (e?.mesh) out.push(e.mesh); });
    return out;
  }
}

const _v = new THREE.Vector3();

function attrArray(attr, itemSize) {
  // Interleaved or normalised attributes are rare in this app; copy them out plainly.
  if (attr.isInterleavedBufferAttribute || attr.normalized) {
    const out = new Float32Array(attr.count * itemSize);
    for (let i = 0; i < attr.count; i++) { out[i * itemSize] = attr.getX(i); if (itemSize > 1) out[i * itemSize + 1] = attr.getY(i); if (itemSize > 2) out[i * itemSize + 2] = attr.getZ(i); if (itemSize > 3) out[i * itemSize + 3] = attr.getW(i); }
    return out;
  }
  return attr.array;
}

function geometryVersions(g) {
  const a = g.attributes;
  return `${a.position?.version}|${a.normal?.version}|${a.color?.version}|${g.index?.version}|${g.drawRange.start}|${g.drawRange.count}`;
}

// A greyscale height field -> a tangent-space normal map, in place. Babylon's bump slot takes
// normals only; three's takes heights. The Sobel wraps, because every relief tile here tiles.
function heightToNormal(ctx, w, h) {
  const src = ctx.getImageData(0, 0, w, h);
  const d = src.data;
  const H = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) H[i] = (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 765;
  // Calibrated by eye against the main app: strong enough that stone reads as stone under a
  // raking sun, weak enough that a painted deck does not turn to corrugated iron.
  const strength = 1.1 * Math.min(1, 256 / Math.max(w, h)) * 2.2;
  for (let y = 0; y < h; y++) {
    const y0 = ((y + h - 1) % h) * w; const y1 = ((y + 1) % h) * w;
    for (let x = 0; x < w; x++) {
      const x0 = (x + w - 1) % w; const x1 = (x + 1) % w;
      const dx = (H[y * w + x1] - H[y * w + x0]) * strength * 4;
      const dy = (H[y1 + x] - H[y0 + x]) * strength * 4;
      const l = Math.hypot(dx, dy, 1);
      const o = (y * w + x) * 4;
      d[o] = (-dx / l * 0.5 + 0.5) * 255; d[o + 1] = (dy / l * 0.5 + 0.5) * 255; d[o + 2] = (1 / l * 0.5 + 0.5) * 255; d[o + 3] = 255;
    }
  }
  ctx.putImageData(src, 0, 0);
}
