// Pictures of the Model Database's models, rendered by the real app in headless Chrome.
//
//   npx vite --port 5199 --strictPort              (in another terminal)
//   node tools/model-pictures.mjs                  every model's card picture and turntable
//   node tools/model-pictures.mjs --only violin,djembe
//   node tools/model-pictures.mjs --shot violin    look at one model: writes scratch/model-shots/
//
// The default writes three places: public/models/ and HiFi/public/models/ (each edition serves
// its own copy) and docs/assets/models/ (the card pictures only, for the teacher page).
//
// --shot is the check for a model being built. It writes five views fitted to the model, and
// four from a 5ft eye six feet from its surface at its catalogue size, which is the distance a
// student actually reads it from and the only one that shows a gap. It also prints triangles,
// meshes, transparent meshes and size. LOOK at the pictures: a count cannot see an inside-out
// surface.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP_URL = process.env.APP_URL || 'http://localhost:5199/';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const THUMB = 360;
const SPIN = 300;
const SPIN_FRAMES = 12;

const argv = process.argv.slice(2);
const flag = (name) => {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? null : (argv[at + 1] ?? '');
};
const shotId = flag('shot');
const only = flag('only')?.split(',').map((s) => s.trim()).filter(Boolean) ?? null;

async function loadPlaywright() {
  try {
    return await import('playwright-core');
  } catch {
    return import(pathToFileURL(resolve(ROOT, 'book/node_modules/playwright-core/index.mjs')).href);
  }
}

function writeData(path, dataUrl) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
}

// Everything below runs in the page. The stage is a scene of its own drawn by the app's own
// renderer, so a picture has the tone mapping a student sees, with the app's loop stopped so the
// frame can be read back in the same task it was drawn in (the drawing buffer is not preserved).
const STAGE = `
window.__stage = await (async () => {
  const { THREE, renderer } = window.__debug;
  const { buildCatalogModel } = await import('/src/models/index.js');
  const { MODEL_BY_ID, MODELS } = await import('/src/models/catalog.js');
  renderer.setAnimationLoop(null);

  const sky = document.createElement('canvas');
  sky.width = sky.height = 512;
  const c = sky.getContext('2d');
  const g = c.createRadialGradient(256, 200, 40, 256, 256, 420);
  g.addColorStop(0, '#8a98a5');
  g.addColorStop(1, '#46515c');
  c.fillStyle = g;
  c.fillRect(0, 0, 512, 512);
  const background = new THREE.CanvasTexture(sky);
  background.colorSpace = THREE.SRGBColorSpace;

  function setup(id, { scaled }) {
    return buildCatalogModel(id).then((model) => {
      const entry = MODEL_BY_ID.get(id);
      const scene = new THREE.Scene();
      scene.background = background;
      if (scaled) model.scale.setScalar(entry.scale ?? 1);
      scene.add(model);
      model.updateMatrixWorld(true);

      const box = new THREE.Box3();
      const child = new THREE.Box3();
      model.traverse((n) => {
        if (!n.isMesh || !n.geometry) return;
        if (!n.geometry.boundingBox) n.geometry.computeBoundingBox();
        child.copy(n.geometry.boundingBox).applyMatrix4(n.matrixWorld);
        box.union(child);
      });
      const centre = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const radius = Math.max(size.length() / 2, 0.5);

      scene.add(new THREE.HemisphereLight(0xffffff, 0x8d9196, 1.55));
      const sun = new THREE.DirectionalLight(0xfff3e2, 2.7);
      sun.position.set(centre.x + radius * 1.4, centre.y + radius * 2.6, centre.z + radius * 1.9);
      sun.target.position.copy(centre);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      const cam = sun.shadow.camera;
      cam.left = cam.bottom = -radius * 1.5;
      cam.right = cam.top = radius * 1.5;
      cam.near = 0.1;
      cam.far = radius * 7;
      sun.shadow.bias = -0.0006;
      sun.shadow.normalBias = radius * 0.004;
      scene.add(sun, sun.target);

      const floor = new THREE.Mesh(
        new THREE.CircleGeometry(radius * 8, 48),
        new THREE.ShadowMaterial({ opacity: 0.34 })
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = box.min.y - radius * 0.002;
      floor.receiveShadow = true;
      scene.add(floor);
      return { entry, model, scene, box, centre, size, radius };
    });
  }

  const corners = (box) => {
    const out = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) out.push(new THREE.Vector3(x, y, z));
    return out;
  };

  function fitCamera(stage, azimuth, elevation, aspect = 1, fill = 0.86) {
    const camera = new THREE.PerspectiveCamera(26, aspect, 0.05, 6000);
    const dir = new THREE.Vector3(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation));
    let distance = stage.radius / Math.sin(THREE.MathUtils.degToRad(13));
    for (let i = 0; i < 6; i += 1) {
      camera.position.copy(stage.centre).addScaledVector(dir, distance);
      camera.lookAt(stage.centre);
      camera.updateMatrixWorld(true);
      camera.updateProjectionMatrix();
      let reach = 0;
      for (const p of corners(stage.box)) {
        const v = p.clone().project(camera);
        reach = Math.max(reach, Math.abs(v.x), Math.abs(v.y));
      }
      distance *= reach / fill;
    }
    camera.position.copy(stage.centre).addScaledVector(dir, distance);
    camera.lookAt(stage.centre);
    camera.far = distance + stage.radius * 12;
    camera.updateProjectionMatrix();
    return camera;
  }

  function draw(stage, camera, w, h) {
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false);
    renderer.render(stage.scene, camera);
    renderer.render(stage.scene, camera);
    return renderer.domElement;
  }

  function dispose(stage) {
    stage.scene.traverse((n) => {
      n.geometry?.dispose?.();
      const mats = Array.isArray(n.material) ? n.material : n.material ? [n.material] : [];
      for (const m of mats) {
        for (const value of Object.values(m)) if (value?.isTexture && value !== background) value.dispose();
        m.dispose();
      }
    });
  }

  function stats(stage) {
    let triangles = 0, meshes = 0, transparent = 0, lights = 0;
    stage.model.traverse((n) => {
      if (n.isLight) lights += 1;
      if (!n.isMesh) return;
      meshes += 1;
      const g = n.geometry;
      triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
      if ((Array.isArray(n.material) ? n.material : [n.material]).some((m) => m.transparent)) transparent += 1;
    });
    const s = stage.size;
    return { triangles: Math.round(triangles), meshes, transparent, lights, size: [s.x, s.y, s.z].map((v) => Number(v.toFixed(2))) };
  }

  return {
    ids: MODELS.map((m) => m.id),
    async pictures(id, thumbSize, spinSize, frames) {
      const stage = await setup(id, { scaled: false });
      stage.model.rotation.y = stage.entry.yaw ?? 0;
      stage.model.updateMatrixWorld(true);
      // The framing has to measure the model as it now stands, or a long one turned broadside
      // overflows the picture.
      stage.box.makeEmpty();
      const part = new THREE.Box3();
      stage.model.traverse((n) => {
        if (!n.isMesh || !n.geometry) return;
        part.copy(n.geometry.boundingBox).applyMatrix4(n.matrixWorld);
        stage.box.union(part);
      });
      stage.box.getCenter(stage.centre);
      const elevation = THREE.MathUtils.degToRad(stage.entry.pictureElevation ?? 16);
      // A model with its own yaw is pictured from where a student first sees it. One without
      // gets a three-quarter view, since dead ahead flattens most things.
      const azimuth = stage.entry.yaw ? 0 : 0.42;
      const thumb = draw(stage, fitCamera(stage, azimuth, elevation), thumbSize, thumbSize).toDataURL('image/webp', 0.8);
      const sheet = document.createElement('canvas');
      sheet.width = spinSize * frames;
      sheet.height = spinSize;
      const ctx = sheet.getContext('2d');
      for (let i = 0; i < frames; i += 1) {
        const frame = draw(stage, fitCamera(stage, azimuth + (i / frames) * Math.PI * 2, elevation), spinSize, spinSize);
        ctx.drawImage(frame, i * spinSize, 0);
      }
      const spin = sheet.toDataURL('image/webp', 0.72);
      dispose(stage);
      return { thumb, spin };
    },
    async shot(id) {
      const fitted = await setup(id, { scaled: false });
      const out = { stats: stats(fitted), views: {} };
      const views = { front: [0, 14], right: [90, 14], back: [180, 14], left: [270, 14], top: [30, 58] };
      for (const [name, [az, el]] of Object.entries(views)) {
        const camera = fitCamera(fitted, THREE.MathUtils.degToRad(az), THREE.MathUtils.degToRad(el), 1, 0.9);
        out.views[name] = draw(fitted, camera, 900, 900).toDataURL('image/jpeg', 0.88);
      }
      dispose(fitted);

      const near = await setup(id, { scaled: true });
      for (const [name, az] of Object.entries({ near_front: 0, near_right: 90, near_back: 180, near_left: 270 })) {
        const a = THREE.MathUtils.degToRad(az);
        const dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
        const reach = Math.abs(dir.x) * near.size.x / 2 + Math.abs(dir.z) * near.size.z / 2;
        const camera = new THREE.PerspectiveCamera(70, 16 / 10, 0.1, 2000);
        const eye = near.box.min.y + 5;
        camera.position.set(near.centre.x + dir.x * (reach + 6), eye, near.centre.z + dir.z * (reach + 6));
        camera.lookAt(near.centre.x, Math.min(eye, near.centre.y), near.centre.z);
        out.views[name] = draw(near, camera, 1000, 625).toDataURL('image/jpeg', 0.88);
      }
      dispose(near);
      return out;
    },
  };
})();
`;

async function main() {
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl'],
  });
  const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${APP_URL}?studio`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__debug?.renderer, null, { timeout: 120000 });
  await page.evaluate(`(async () => { ${STAGE} })()`);

  if (shotId) {
    const { stats, views } = await page.evaluate((id) => window.__stage.shot(id), shotId);
    console.log(`${shotId}: ${stats.triangles} triangles, ${stats.meshes} meshes, ${stats.transparent} transparent, ${stats.lights} lights, ${stats.size.join(' x ')} ft at scale 1`);
    for (const [name, data] of Object.entries(views)) {
      const path = resolve(ROOT, `scratch/model-shots/${shotId}-${name}.jpg`);
      writeData(path, data);
      console.log(path);
    }
  } else {
    const ids = only ?? await page.evaluate(() => window.__stage.ids);
    for (const id of ids) {
      let pictures;
      try {
        pictures = await page.evaluate(
          ([modelId, t, s, f]) => window.__stage.pictures(modelId, t, s, f),
          [id, THUMB, SPIN, SPIN_FRAMES],
        );
      } catch (err) {
        console.log(`${id}: FAILED ${err.message.split('\n')[0]}`);
        continue;
      }
      const { thumb, spin } = pictures;
      for (const base of ['public/models', 'HiFi/public/models']) {
        writeData(resolve(ROOT, `${base}/thumbs/${id}.webp`), thumb);
        writeData(resolve(ROOT, `${base}/spin/${id}.webp`), spin);
      }
      writeData(resolve(ROOT, `docs/assets/models/${id}.webp`), thumb);
      console.log(`${id}: ok`);
    }
  }
  const real = errors.filter((e) => !/favicon|edusim-analytics|fonts\.g/.test(e));
  if (real.length) console.log(`Page errors:\n  ${real.slice(0, 12).join('\n  ')}`);
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
