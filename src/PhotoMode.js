import * as THREE from 'three';
import { uuid } from './Uuid.js';
import { loadImagePlane } from './MediaLoader.js';
import { faceCamera } from './Placement.js';

// PHOTO MODE.
//
// Press it and the menu, the D-pad and the toasts all go; black bars slide in, a thirds
// grid appears, and you are looking at the world and nothing else. Then three things can
// happen to the picture: it can be saved, it can be kept for a comic strip, or -- the one
// that makes this worth building -- it can be HUNG IN THE WORLD, ten feet ahead of where
// you took it, as an ordinary object you can walk round the back of.
//
// That last one is the quiet masterstroke and it needed almost no code: a photograph
// becomes an ordinary `image` record, so it saves to IndexedDB, exports into a world file,
// rehydrates on the other person's machine, and can be moved, resized, programmed and
// duplicated -- all with no per-kind code anywhere, because `image` already does all of
// that.
//
// TWO TRAPS, BOTH SILENT, both recorded here because neither produces an error.
//
// 1. THE RENDERER IS BUILT WITHOUT preserveDrawingBuffer (main.js:32). A WebGL drawing
//    buffer is cleared after it is composited, so canvas.toBlob() or drawImage(canvas)
//    called from a click handler on a LATER tick returns a black rectangle -- no
//    exception, no warning, just black. The capture therefore happens inside animate(),
//    in the same task as renderer.render(), via a one-shot flag. Setting
//    preserveDrawingBuffer at construction would also work and would tax memory bandwidth
//    on integrated graphics every frame forever for a button pressed twice a lesson.
//
// 2. DO NOT REACH FOR A WebGLRenderTarget TO FIX IT. three forces the linear working
//    colour space and NoToneMapping while a non-XR target is bound, so the photograph
//    comes back dark, flat and visibly not the frame the student composed -- and the app
//    runs ACESFilmicToneMapping, so the difference is large.
//
// The CSS3D layer cannot appear in a photograph at all, and that is a real limit rather
// than an oversight: browser panels are DOM composited OVER the canvas, and there is no
// way to read them back into it. A photo of a world with a browser panel in it has a
// panel-shaped hole. The bezel still shows, which is the best available answer.

const FILMS = [
  { id: 'colour', label: 'Colour', hint: 'Just as it looks.' },
  { id: 'newsreel', label: '1949', hint: 'Grainy black and white, like an old newsreel.' },
  { id: 'chalk', label: 'Chalk', hint: 'Soft and pale, like a drawing.' },
  { id: 'blueprint', label: 'Blueprint', hint: 'White lines on deep blue.' },
  { id: 'sunprint', label: 'Sunprint', hint: 'Warm old brown, like a photograph in an album.' },
];

const ZOOMS = [
  { label: 'Wide', fov: 92 },
  { label: 'Normal', fov: 70 },
  { label: 'Close', fov: 38 },
];

export class PhotoMode {
  constructor({ scene, camera, renderer, registry, worldStore, menu, player, groundHeightAt, cinema }) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.registry = registry;
    this.worldStore = worldStore;
    this.menu = menu;
    this.player = player;
    this.groundHeightAt = groundHeightAt;
    this.cinema = cinema;

    this.active = false;
    this.pending = false;     // the one-shot capture flag animate() consumes
    this.film = 'colour';
    this.baseFov = camera.fov;
    this.shot = null;         // the canvas of the picture just taken

    this.root = document.createElement('div');
    this.root.id = 'photo-mode';
    this.root.hidden = true;
    document.body.appendChild(this.root);

    window.addEventListener('keydown', (e) => {
      if (!this.active) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.close();
      }
      // Space is the shutter, because that is what a camera's shutter is on every device
      // that has ever had one. Guarded on isEditableTarget's job -- there is no text field
      // on screen in photo mode, so a bare check is enough.
      if (e.code === 'Space') {
        e.preventDefault();
        this.capture();
      }
    });
  }

  open() {
    if (this.active) return;
    // A rig and photo mode both want the eyes. Photo mode wins, because the student asked
    // for it more recently -- but a rig left running would keep moving the view under the
    // frame they are trying to compose.
    this.cinema?.release();
    this.active = true;
    this.shot = null;
    this.baseFov = this.camera.fov;
    document.body.classList.add('photo-mode');
    this.root.hidden = false;
    this.renderViewfinder();
  }

  close() {
    if (!this.active) return;
    this.active = false;
    this.shot = null;
    this.setFov(this.baseFov);
    document.body.classList.remove('photo-mode');
    this.root.hidden = true;
  }

  setFov(fov) {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  // --- the viewfinder ------------------------------------------------------------

  renderViewfinder() {
    this.root.innerHTML = '';

    // Letterbox bars. They are not decoration: they are what tells a student this is a
    // PICTURE rather than the app having broken, and they give the controls somewhere to
    // sit that is not on top of the thing being photographed.
    const top = document.createElement('div');
    top.className = 'pm-bar pm-bar-top';
    const bottom = document.createElement('div');
    bottom.className = 'pm-bar pm-bar-bottom';

    const grid = document.createElement('div');
    grid.className = 'pm-grid';
    grid.innerHTML = '<span></span><span></span><span></span><span></span>';

    // The title and the way out live in the TOP bar, which is otherwise empty, so the
    // bottom bar carries only the three controls a student actually operates. Crowded
    // into one bar, Done was clipped off the bottom edge of the screen.
    const heading = document.createElement('div');
    heading.className = 'pm-head';
    const title = document.createElement('div');
    title.className = 'pm-title';
    title.textContent = 'Point the camera and press the button';

    const controls = document.createElement('div');
    controls.className = 'pm-controls';

    const films = document.createElement('div');
    films.className = 'pm-chips';
    for (const film of FILMS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pm-chip';
      btn.textContent = film.label;
      btn.title = film.hint;
      if (film.id === this.film) btn.classList.add('is-on');
      btn.addEventListener('click', () => {
        this.film = film.id;
        this.renderViewfinder();
      });
      films.appendChild(btn);
    }

    const zooms = document.createElement('div');
    zooms.className = 'pm-chips';
    for (const zoom of ZOOMS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pm-chip';
      btn.textContent = zoom.label;
      if (Math.abs(this.camera.fov - zoom.fov) < 0.5) btn.classList.add('is-on');
      btn.addEventListener('click', () => {
        this.setFov(zoom.fov);
        this.renderViewfinder();
      });
      zooms.appendChild(btn);
    }

    const row = document.createElement('div');
    row.className = 'pm-row';

    const shutter = document.createElement('button');
    shutter.type = 'button';
    shutter.className = 'pm-shutter';
    shutter.title = 'Take the picture (or press the space bar)';
    shutter.addEventListener('click', () => this.capture());

    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'pm-exit';
    done.textContent = 'Done';
    done.addEventListener('click', () => this.close());

    row.append(zooms, shutter, films);
    controls.append(row);
    bottom.appendChild(controls);
    heading.append(title, done);
    top.appendChild(heading);
    this.root.append(top, grid, bottom);
  }

  capture() {
    if (!this.active || this.shot) return;
    // Just raise the flag. The actual read has to happen inside the frame loop -- see the
    // note at the top of this file about the drawing buffer.
    this.pending = true;
  }

  // Called from animate(), IMMEDIATELY after renderer.render(scene, camera), in the same
  // task as the draw. This is the only place a capture can legally happen.
  afterRender() {
    if (!this.pending) return;
    this.pending = false;

    const source = this.renderer.domElement;
    const canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(source, 0, 0);
    this.applyFilm(ctx, canvas.width, canvas.height);

    this.shot = canvas;
    this.renderResult();
  }

  // --- film stocks ---------------------------------------------------------------
  //
  // A canvas pass over the captured pixels, not a post-processing pipeline: the picture is
  // a STILL, so it costs nothing at runtime and only ever runs on the shutter press. Each
  // one belongs to a world this app already has, which is what stops them being a generic
  // filter menu -- 1949 is Broadway, Chalk is Simon's meadow, Blueprint is a build in
  // progress.
  applyFilm(ctx, w, h) {
    if (this.film === 'colour') return;
    const image = ctx.getImageData(0, 0, w, h);
    const d = image.data;

    for (let i = 0; i < d.length; i += 4) {
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      // Rec. 709, the same weighting SurfaceTextures uses for its ground maps: the eye is
      // far more sensitive to green, and a flat channel average visibly darkens foliage.
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;

      if (this.film === 'newsreel') {
        const v = Math.min(255, lum * 1.06);
        d[i] = v; d[i + 1] = v; d[i + 2] = v;
      } else if (this.film === 'sunprint') {
        d[i] = Math.min(255, lum * 1.07 + 28);
        d[i + 1] = Math.min(255, lum * 0.93 + 12);
        d[i + 2] = Math.min(255, lum * 0.68);
      } else if (this.film === 'blueprint') {
        // Inverted: paper is the dark ground and the drawing is the light on it.
        const v = lum / 255;
        d[i] = Math.round(28 + v * 120);
        d[i + 1] = Math.round(58 + v * 150);
        d[i + 2] = Math.round(112 + v * 128);
      } else if (this.film === 'chalk') {
        // High key, desaturated toward paper white but not all the way -- chalk is not
        // black and white, it is pale colour on a pale ground.
        d[i] = Math.min(255, r * 0.55 + lum * 0.3 + 74);
        d[i + 1] = Math.min(255, g * 0.55 + lum * 0.3 + 74);
        d[i + 2] = Math.min(255, b * 0.55 + lum * 0.3 + 70);
      }
    }
    ctx.putImageData(image, 0, 0);

    // Grain, and it is what sells the two old stocks. A big smooth gradient with no grain
    // reads as a filter; with grain it reads as film. Drawn as sparse dots rather than
    // per-pixel noise, which would cost a second full pass over the buffer.
    if (this.film === 'newsreel' || this.film === 'sunprint') {
      ctx.save();
      ctx.globalAlpha = 0.06;
      const dots = Math.floor((w * h) / 900);
      for (let i = 0; i < dots; i++) {
        const x = Math.random() * w;
        const y = Math.random() * h;
        ctx.fillStyle = Math.random() > 0.5 ? '#fff' : '#000';
        ctx.fillRect(x, y, 1.4, 1.4);
      }
      ctx.restore();
    }

    // Vignette. Every one of these stocks is a lens with a worse corner than its middle.
    if (this.film !== 'chalk') {
      const grad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.max(w, h) * 0.72);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, this.film === 'blueprint' ? 'rgba(4,16,40,0.55)' : 'rgba(0,0,0,0.5)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }
  }

  // --- what happens to the picture -----------------------------------------------

  renderResult() {
    this.root.innerHTML = '';

    const sheet = document.createElement('div');
    sheet.className = 'pm-result';

    const frame = document.createElement('div');
    frame.className = 'pm-photo';
    const img = document.createElement('img');
    img.src = this.shot.toDataURL('image/jpeg', 0.92);
    img.alt = 'The photograph you just took';
    frame.appendChild(img);

    const row = document.createElement('div');
    row.className = 'pm-result-row';

    const hang = document.createElement('button');
    hang.type = 'button';
    hang.className = 'pm-act pm-act-primary';
    hang.textContent = 'Hang it here';
    hang.title = 'Stand it up in the world, right where you are';
    hang.addEventListener('click', () => this.hangItHere());

    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'pm-act';
    save.textContent = 'Save to my computer';
    save.addEventListener('click', () => this.download());

    const again = document.createElement('button');
    again.type = 'button';
    again.className = 'pm-act';
    again.textContent = 'Take another';
    again.addEventListener('click', () => {
      this.shot = null;
      this.renderViewfinder();
    });

    row.append(hang, save, again);
    sheet.append(frame, row);
    this.root.appendChild(sheet);
  }

  filename() {
    // No Date formatting beyond the day: a filename is for finding a file, and a student
    // looking through Downloads wants "edusim-photo" and a date, not a millisecond stamp.
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return `edusim-photo-${stamp}-${Math.floor(Math.random() * 9000 + 1000)}.jpg`;
  }

  // A photo bound for the WORLD is downscaled; one bound for the student's computer is
  // not. The reason is world-file size: a full-resolution capture is about 650KB, and a
  // world file is 9-30KB today -- five photos would make the file a hundred times bigger
  // than the world it is a picture of, in a format that base64s every byte on export.
  // At the size a photo actually renders in-world -- a plane a few feet across -- 1024px
  // is already more than anybody can resolve.
  toBlobFor(target) {
    const wide = target === 'world' ? 1024 : this.shot.width;
    const quality = target === 'world' ? 0.82 : 0.92;
    if (this.shot.width <= wide) {
      return new Promise((resolve) => this.shot.toBlob(resolve, 'image/jpeg', quality));
    }
    const scale = wide / this.shot.width;
    const small = document.createElement('canvas');
    small.width = Math.round(this.shot.width * scale);
    small.height = Math.round(this.shot.height * scale);
    const ctx = small.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.shot, 0, 0, small.width, small.height);
    return new Promise((resolve) => small.toBlob(resolve, 'image/jpeg', quality));
  }

  download() {
    this.shot.toBlob(
      (blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = this.filename();
        document.body.appendChild(a);
        a.click();
        a.remove();
        // Revoked on a timeout rather than immediately: revoking in the same task as the
        // click cancels the download in some browsers.
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        this.menu?.toast('Photo saved — check your downloads.', { tone: 'success' });
      },
      'image/jpeg',
      0.92,
    );
  }

  // THE ONE THAT MAKES THIS WORTH BUILDING. The photograph becomes an ordinary `image`
  // record, which means every piece of machinery in the app already knows what to do with
  // it -- persistence, world-file export, rehydration on a classmate's machine, the object
  // menu, programs, duplicate. No new record kind, no new branch in rehydrateOne.
  async hangItHere() {
    const canvas = this.shot;
    if (!canvas) return;
    const name = this.filename();
    const blob = await this.toBlobFor('world');
    if (!blob) {
      this.menu?.toast('Could not hang that one up.', { tone: 'error' });
      return;
    }
    const file = new File([blob], name, { type: 'image/jpeg' });

    try {
      const { mesh, planeHeight } = await loadImagePlane(file, { isGif: false });

      // Stood a little way in front of where the student is standing, facing them -- so
      // the photograph appears where they are looking rather than somewhere they have to
      // go and find. Deliberately NOT on the placement spiral: a photo has a place it
      // belongs, which is here.
      const dir = this.camera.getWorldDirection(new THREE.Vector3());
      dir.y = 0;
      if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
      dir.normalize();
      const x = this.camera.position.x + dir.x * 9;
      const z = this.camera.position.z + dir.z * 9;

      // Sized and stood like a display board rather than dropped on the grass. The shared
      // image sizing gives a photo about 2.8ft tall with its base on the ground, which
      // reads as litter; five feet with its base a little clear of the grass reads as
      // something somebody put there on purpose, and matches the activity boards this
      // world is already full of. Set BEFORE the record is built, so the scale persists.
      const HUNG_HEIGHT = 5;
      const k = planeHeight > 0 ? HUNG_HEIGHT / planeHeight : 1;
      mesh.scale.multiplyScalar(k);
      mesh.position.set(x, this.groundHeightAt(x, z) + 0.55 + HUNG_HEIGHT / 2, z);
      faceCamera(mesh, this.camera);
      this.scene.add(mesh);

      const id = uuid();
      const record = {
        id,
        kind: 'image',
        createdAt: Date.now(),
        transform: {
          position: mesh.position.toArray(),
          rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
          scale: mesh.scale.toArray(),
        },
        primaryFileName: name,
        files: [{ name, type: file.type, data: file }],
      };
      this.registry.add(id, mesh, { record });
      await this.worldStore?.saveObject(record);

      this.close();
      this.menu?.toast('Hung it up — it is part of this world now.', { tone: 'success' });
    } catch (err) {
      console.error('Could not hang the photo:', err);
      this.menu?.toast('Could not hang that one up.', { tone: 'error' });
    }
  }
}
