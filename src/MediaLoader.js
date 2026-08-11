import * as THREE from 'three';
import { IMAGE_PLANE_MAX_SIZE } from './config.js';

function computePlaneSize(naturalW, naturalH) {
  const aspect = naturalW / naturalH || 1;
  if (aspect >= 1) {
    return { w: IMAGE_PLANE_MAX_SIZE, h: IMAGE_PLANE_MAX_SIZE / aspect };
  }
  return { w: IMAGE_PLANE_MAX_SIZE * aspect, h: IMAGE_PLANE_MAX_SIZE };
}

export function loadImageElement(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode image'));
    img.src = url;
  });
}

// Builds a flat, camera-facing-at-placement-time picture plane from an image/gif Blob.
// Returns { mesh, planeHeight, tick } — tick is only present for animated gifs and must
// be driven each frame (tick.update()) and cleaned up on removal (tick.dispose()).
export async function loadImagePlane(file, { isGif }) {
  const url = URL.createObjectURL(file);
  let img;
  try {
    img = await loadImageElement(url);
  } finally {
    URL.revokeObjectURL(url);
  }

  const { w, h } = computePlaneSize(img.naturalWidth, img.naturalHeight);
  const geometry = new THREE.PlaneGeometry(w, h);

  let material;
  let tick = null;

  if (isGif) {
    // Kept attached (off-screen, not display:none) so the browser keeps animating it.
    img.style.position = 'fixed';
    img.style.left = '-9999px';
    img.style.width = '1px';
    img.style.height = '1px';
    document.body.appendChild(img);

    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, transparent: true });

    tick = {
      update() {
        if (img.complete && img.naturalWidth) {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          texture.needsUpdate = true;
        }
      },
      dispose() {
        texture.dispose();
        img.remove();
      },
    };
  } else {
    const texture = new THREE.Texture(img);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, transparent: true });
  }

  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.planeHeight = h;
  return { mesh, planeHeight: h, tick };
}
