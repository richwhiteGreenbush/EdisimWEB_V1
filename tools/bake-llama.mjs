// Bakes the supplied rigged Llama.glb down to a static, animation-free GLB.
// The app has no AnimationMixer, so 26 clips + a 46-joint skeleton + IK/pole-target
// nodes are all unusable data; skinning is evaluated once at the bind pose and the
// deformed positions are written out as plain geometry.
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const SRC = '/Users/richwhite/Desktop/WorldModels/Llama.glb';
const OUT = 'public/llama/llama.glb';

const buf = fs.readFileSync(SRC);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

new GLTFLoader().parse(ab, '', (gltf) => {
  const root = gltf.scene;
  root.updateMatrixWorld(true);

  // ---- 1. bake skinning at the bind pose, into world space ------------------
  const prims = [];
  root.traverse((n) => { if (n.isSkinnedMesh || n.isMesh) prims.push(n); });

  const v = new THREE.Vector3(), nrm = new THREE.Vector3();
  const baked = [];
  // three's skinning shader transforms a normal by the upper 3x3 of
  //   bindMatrixInverse * (sum w_i * boneWorld_i * boneInverse_i) * bindMatrix
  // Reproducing that exactly is what makes the bake match what the ORIGINAL renders;
  // an inverse-transpose "correction" here would be more textbook-correct and would
  // silently shade differently from the file it replaces.
  const skinN = new THREE.Matrix3(), accN = new THREE.Matrix3(), tmpN = new THREE.Matrix3();
  const tmp4 = new THREE.Matrix4();
  for (const m of prims) {
    const g = m.geometry;
    const pos = g.attributes.position, nor = g.attributes.normal;
    const count = pos.count;
    const P = new Float32Array(count * 3), N = new Float32Array(count * 3);
    const worldN = new THREE.Matrix3().getNormalMatrix(m.matrixWorld);
    const bindN = m.isSkinnedMesh ? new THREE.Matrix3().setFromMatrix4(m.bindMatrix) : null;
    const bindInvN = m.isSkinnedMesh ? new THREE.Matrix3().setFromMatrix4(m.bindMatrixInverse) : null;
    for (let i = 0; i < count; i++) {
      v.fromBufferAttribute(pos, i);
      if (m.isSkinnedMesh) m.applyBoneTransform(i, v);
      v.applyMatrix4(m.matrixWorld);
      P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z;

      nrm.fromBufferAttribute(nor, i);
      if (m.isSkinnedMesh) {
        const si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
        for (let e = 0; e < 9; e++) accN.elements[e] = 0;
        for (let k = 0; k < 4; k++) {
          const w = sw.getComponent(i * 4 + k - i * 4 + 0) ?? 0;
          const weight = [sw.getX(i), sw.getY(i), sw.getZ(i), sw.getW(i)][k];
          if (weight === 0) continue;
          const bi = [si.getX(i), si.getY(i), si.getZ(i), si.getW(i)][k];
          tmp4.multiplyMatrices(m.skeleton.bones[bi].matrixWorld, m.skeleton.boneInverses[bi]);
          tmpN.setFromMatrix4(tmp4);
          for (let e = 0; e < 9; e++) accN.elements[e] += tmpN.elements[e] * weight;
        }
        skinN.copy(bindInvN).multiply(accN).multiply(bindN);
        nrm.applyMatrix3(skinN);
      }
      nrm.applyMatrix3(worldN).normalize();
      N[i * 3] = nrm.x; N[i * 3 + 1] = nrm.y; N[i * 3 + 2] = nrm.z;
    }
    const index = g.index ? Array.from(g.index.array) : null;
    baked.push({ name: m.material.name, P, N, index, count, material: m.material });
  }

  // ---- 2. re-centre: base on y=0, body centred on x/z ----------------------
  let minY = Infinity, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const b of baked) for (let i = 0; i < b.count; i++) {
    const x = b.P[i*3], y = b.P[i*3+1], z = b.P[i*3+2];
    if (y < minY) minY = y; if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const dx = -(minX + maxX) / 2, dy = -minY, dz = -(minZ + maxZ) / 2;
  for (const b of baked) for (let i = 0; i < b.count; i++) {
    b.P[i*3] += dx; b.P[i*3+1] += dy; b.P[i*3+2] += dz;
  }
  console.log('recentred by', dx.toFixed(4), dy.toFixed(4), dz.toFixed(4));

  

  // ---- 3. write a minimal GLB ---------------------------------------------
  const json = { asset: { version: '2.0', generator: 'Edusim bake-llama (static, animation-free)' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: 'Llama', mesh: 0 }],
    meshes: [{ name: 'Llama', primitives: [] }], materials: [], accessors: [], bufferViews: [], buffers: [] };

  const chunks = []; let offset = 0;
  const pushBV = (typedArray, target) => {
    const bytes = Buffer.from(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
    const pad = (4 - (bytes.length % 4)) % 4;
    json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(target ? { target } : {}) });
    chunks.push(bytes); if (pad) chunks.push(Buffer.alloc(pad));
    offset += bytes.length + pad;
    return json.bufferViews.length - 1;
  };

  for (const b of baked) {
    const matIndex = json.materials.length;
    const src = b.material;
    json.materials.push({
      name: b.name,
      pbrMetallicRoughness: {
        baseColorFactor: [src.color.r, src.color.g, src.color.b, 1],
        // The app ships NO environment map anywhere, so any metalness darkens a
        // surface with nothing to reflect. Wool and horn are dielectric regardless.
        metallicFactor: 0,
        roughnessFactor: b.name === 'Eyes_Black' || b.name === 'Eyes_White' ? 0.25 : 0.85,
      },
    });

    // POSITION
    let mnx=Infinity,mny=Infinity,mnz=Infinity,mxx=-Infinity,mxy=-Infinity,mxz=-Infinity;
    for (let i=0;i<b.count;i++){const x=b.P[i*3],y=b.P[i*3+1],z=b.P[i*3+2];
      if(x<mnx)mnx=x; if(y<mny)mny=y; if(z<mnz)mnz=z; if(x>mxx)mxx=x; if(y>mxy)mxy=y; if(z>mxz)mxz=z;}
    const posBV = pushBV(b.P, 34962);
    json.accessors.push({ bufferView: posBV, componentType: 5126, count: b.count, type: 'VEC3',
      min: [mnx,mny,mnz], max: [mxx,mxy,mxz] });
    const posAcc = json.accessors.length - 1;

    const norBV = pushBV(b.N, 34962);
    json.accessors.push({ bufferView: norBV, componentType: 5126, count: b.count, type: 'VEC3' });
    const norAcc = json.accessors.length - 1;

    const attributes = { POSITION: posAcc, NORMAL: norAcc };
    let indicesAcc;
    if (b.index) {
      const big = b.count > 65535;
      const arr = big ? new Uint32Array(b.index) : new Uint16Array(b.index);
      const bv = pushBV(arr, 34963);
      json.accessors.push({ bufferView: bv, componentType: big ? 5125 : 5123, count: arr.length, type: 'SCALAR' });
      indicesAcc = json.accessors.length - 1;
    }
    json.meshes[0].primitives.push({ attributes, ...(indicesAcc != null ? { indices: indicesAcc } : {}), material: matIndex });
  }

  const bin = Buffer.concat(chunks);
  json.buffers.push({ byteLength: bin.length });

  let jsonStr = JSON.stringify(json);
  while (jsonStr.length % 4 !== 0) jsonStr += ' ';
  const jsonBuf = Buffer.from(jsonStr, 'utf8');

  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
  const jsonHdr = Buffer.alloc(8); jsonHdr.writeUInt32LE(jsonBuf.length, 0); jsonHdr.write('JSON', 4, 'ascii');
  const binHdr = Buffer.alloc(8); binHdr.writeUInt32LE(bin.length, 0); binHdr.write('BIN\0', 4, 'ascii');

  fs.mkdirSync('public/llama', { recursive: true });
  fs.writeFileSync(OUT, Buffer.concat([header, jsonHdr, jsonBuf, binHdr, bin]));
  const outSize = fs.statSync(OUT).size;
  console.log('wrote', OUT, outSize, 'bytes  (was', buf.length, '=>', (100 - outSize/buf.length*100).toFixed(1), '% smaller)');
}, (e) => { console.error('parse error', e); process.exit(1); });
