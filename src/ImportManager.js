import { loadImagePlane } from './MediaLoader.js';
import { buildBatchLoadingManager, loadModelFile, scaleToHeight, groundLiftFor } from './ModelLoader.js';
import { nextPlacementXZ, faceCamera, countOfKind } from './Placement.js';
import {
  MODEL_MAX_BYTES,
  IMAGE_MAX_BYTES,
  MODEL_ROOT_EXTENSIONS,
  MODEL_AUX_EXTENSIONS,
  IMAGE_EXTENSIONS,
  MODEL_TARGET_HEIGHT,
} from './config.js';

import { uuid } from './Uuid.js';
const MODEL_ROOT_SET = new Set(MODEL_ROOT_EXTENSIONS);
const MODEL_AUX_SET = new Set(MODEL_AUX_EXTENSIONS);
const IMAGE_SET = new Set(IMAGE_EXTENSIONS);
const ALL_ACCEPT = [...MODEL_ROOT_EXTENSIONS, ...MODEL_AUX_EXTENSIONS, ...IMAGE_EXTENSIONS];

function extOf(filename) {
  const match = /\.([a-z0-9]+)$/i.exec(filename);
  return match ? match[1].toLowerCase() : '';
}

function formatBytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export class ImportManager {
  constructor({ scene, camera, groundHeightAt, menu, registry, onPlaced }) {
    this.scene = scene;
    this.camera = camera;
    this.groundHeightAt = groundHeightAt;
    this.menu = menu;
    this.registry = registry;
    this.onPlaced = onPlaced;
    this.busy = false;

    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.multiple = true;
    this.fileInput.accept = ALL_ACCEPT.map((e) => `.${e}`).join(',');
    this.fileInput.style.display = 'none';
    this.fileInput.addEventListener('change', () => {
      const files = [...this.fileInput.files];
      this.fileInput.value = '';
      if (files.length) this.importFiles(files);
    });
    document.body.appendChild(this.fileInput);

    this.onDragOver = (e) => e.preventDefault();
    this.onDrop = (e) => {
      e.preventDefault();
      const files = [...(e.dataTransfer?.files || [])];
      if (files.length) this.importFiles(files);
    };
    window.addEventListener('dragover', this.onDragOver);
    window.addEventListener('drop', this.onDrop);
  }

  openFilePicker() {
    this.fileInput.click();
  }

  validateFile(file) {
    const ext = extOf(file.name);
    const isModelRoot = MODEL_ROOT_SET.has(ext);
    const isModelAux = MODEL_AUX_SET.has(ext);
    const isImage = IMAGE_SET.has(ext);

    if (!isModelRoot && !isModelAux && !isImage) {
      return {
        ok: false,
        reason: `Unsupported file type "${file.name}" — supported: ${ALL_ACCEPT.map((e) => `.${e}`).join(', ')}.`,
      };
    }

    const cap = isImage ? IMAGE_MAX_BYTES : MODEL_MAX_BYTES;
    if (file.size >= cap) {
      return { ok: false, reason: `"${file.name}" is ${formatBytes(file.size)} — the limit is ${formatBytes(cap)}.` };
    }

    return { ok: true, ext, isModelRoot, isModelAux, isImage };
  }

  async importFiles(fileList) {
    if (this.busy) return;
    this.busy = true;
    this.menu?.setImportEnabled(false);

    try {
      const validated = [];
      for (const file of fileList) {
        const result = this.validateFile(file);
        if (!result.ok) {
          this.menu?.toast(result.reason, { tone: 'error' });
          continue;
        }
        validated.push({ file, ...result });
      }
      if (!validated.length) return;

      const modelRoots = validated.filter((v) => v.isModelRoot);
      const hasModel = modelRoots.length > 0;
      const mtlFiles = validated.filter((v) => v.ext === 'mtl');
      const auxFiles = validated.filter((v) => v.isModelAux);
      const imageFiles = validated.filter((v) => v.isImage);

      if (!hasModel && auxFiles.length) {
        for (const aux of auxFiles) {
          this.menu?.toast(`"${aux.file.name}" needs an accompanying .obj/.gltf — skipped.`, { tone: 'error' });
        }
      }

      const imageRoots = hasModel ? [] : imageFiles;
      const auxImageFiles = hasModel ? imageFiles : [];
      const poolFiles = [...modelRoots, ...mtlFiles, ...auxFiles, ...auxImageFiles].map((v) => v.file);
      const { manager, urlMap } = buildBatchLoadingManager(poolFiles);

      const tasks = [
        ...modelRoots.map((v) => this.loadModelRoot(v, manager, mtlFiles)),
        ...imageRoots.map((v) => this.loadImageRoot(v)),
      ];

      const results = await Promise.allSettled(tasks);
      for (const url of urlMap.values()) URL.revokeObjectURL(url);

      let placedAny = false;
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          placedAny = true;
        } else if (result.status === 'rejected') {
          this.menu?.toast(`Import failed: ${result.reason?.message || result.reason}`, { tone: 'error' });
        }
      }
      if (placedAny) this.menu?.toast('Import complete.', { tone: 'success' });
    } finally {
      this.busy = false;
      this.menu?.setImportEnabled(true);
    }
  }

  async loadModelRoot(entry, manager, mtlFiles) {
    const { file, ext } = entry;
    if (ext !== 'glb' && ext !== 'gltf' && ext !== 'obj') return null;

    const base = file.name.replace(/\.[^.]+$/, '').toLowerCase();
    const matchedMtl = mtlFiles.find((m) => m.file.name.toLowerCase().startsWith(base)) || mtlFiles[0];
    const object3D = await loadModelFile({ file, ext, manager, mtlFile: matchedMtl?.file });
    scaleToHeight(object3D, MODEL_TARGET_HEIGHT);
    const lift = groundLiftFor(object3D);

    const { x, z } = nextPlacementXZ(this.camera, countOfKind(this.registry, ['gltf', 'obj']));
    const y = this.groundHeightAt(x, z);
    object3D.position.set(x, y + lift, z);
    object3D.traverse((node) => {
      if (node.isMesh) {
        node.castShadow = true;
        node.receiveShadow = true;
      }
    });
    this.scene.add(object3D);

    const files = [file, ...mtlFiles.map((m) => m.file)];
    const id = uuid();
    const record = {
      id,
      kind: ext === 'obj' ? 'obj' : 'gltf',
      createdAt: Date.now(),
      transform: {
        position: object3D.position.toArray(),
        rotation: [object3D.rotation.x, object3D.rotation.y, object3D.rotation.z],
        scale: object3D.scale.toArray(),
      },
      primaryFileName: file.name,
      files: files.map((f) => ({ name: f.name, type: f.type, data: f })),
    };

    this.registry.add(id, object3D, { record });
    this.onPlaced?.(record);
    return object3D;
  }

  async loadImageRoot(entry) {
    const { file, ext } = entry;
    const isGif = ext === 'gif';
    const { mesh, planeHeight, tick } = await loadImagePlane(file, { isGif });

    const { x, z } = nextPlacementXZ(this.camera, countOfKind(this.registry, ['image', 'gif']));
    const groundY = this.groundHeightAt(x, z);
    mesh.position.set(x, groundY + planeHeight / 2, z);
    faceCamera(mesh, this.camera);
    this.scene.add(mesh);

    const id = uuid();
    const record = {
      id,
      kind: isGif ? 'gif' : 'image',
      createdAt: Date.now(),
      transform: {
        position: mesh.position.toArray(),
        rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
        scale: mesh.scale.toArray(),
      },
      primaryFileName: file.name,
      files: [{ name: file.name, type: file.type, data: file }],
    };

    this.registry.add(id, mesh, { tick, record });
    this.onPlaced?.(record);
    return mesh;
  }
}
