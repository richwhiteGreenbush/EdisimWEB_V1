// VR, on Babylon's own WebXR stack. Same contract as the main app's VRView so the menu wiring
// is unchanged: toggle(), .active, render() (always false here -- Babylon renders the headset
// itself), resize().
//
//  * A headset gets a real immersive-vr session. WebXR works in METRES and this world is in
//    FEET, so the session's worldScalingFactor carries the conversion -- without it a 1.7m
//    adult stands 1.7ft tall in a world three times too big. Thumbstick walking and teleport
//    both come from Babylon's feature manager, walking on the HiFi terrain mesh.
//  * Anything else gets fullscreen side-by-side stereo for a phone in a Cardboard holder: two
//    cameras, 64mm apart (0.21ft), one per half of the screen, both inside the render pipeline
//    so they are tone-mapped like the flat view.

import { FreeCamera, Viewport, Vector3, WebXRFeatureName, WebXRState } from '@babylonjs/core';

const FEET_PER_METRE = 3.280839895;
const EYE_SEPARATION = 0.064 * FEET_PER_METRE;

export class HiFiVR {
  constructor({ scene, camera, terrain, pipeline, threeCamera, player, onNotice }) {
    Object.assign(this, { scene, camera, terrain, pipeline, threeCamera, player, onNotice });
    this.mode = null; this.xr = null; this.eyes = null;
  }

  get active() { return this.mode !== null; }

  async toggle() {
    if (this.active) return this.exit();
    let headset = false;
    try { headset = !!navigator.xr && await navigator.xr.isSessionSupported('immersive-vr'); } catch { headset = false; }
    return headset ? this.enterXR() : this.enterStereo();
  }

  async enterXR() {
    if (!this.xr) {
      this.xr = await this.scene.createDefaultXRExperienceAsync({
        floorMeshes: [this.terrain.mesh], disableDefaultUI: true, optionalFeatures: true,
      });
      const fm = this.xr.baseExperience.featuresManager;
      try {
        fm.enableFeature(WebXRFeatureName.MOVEMENT, 'latest', { xrInput: this.xr.input, movementSpeed: 0.45, rotationSpeed: 0.35, movementOrientationFollowsViewerPose: true });
      } catch { /* teleport remains */ }
      this.xr.baseExperience.onStateChangedObservable.add((state) => {
        if (state === WebXRState.NOT_IN_XR && this.mode === 'xr') { this.mode = null; document.body.classList.remove('vr-active'); this.onNotice?.({ type: 'exited' }); }
      });
    }
    const base = this.xr.baseExperience;
    await base.enterXRAsync('immersive-vr', 'local-floor');
    base.sessionManager.worldScalingFactor = FEET_PER_METRE;
    // Start where the student is standing, feet on the ground they were on.
    const p = this.threeCamera.position;
    base.camera.position.set(p.x, this.terrain.heightAt(p.x, p.z), p.z);
    this.mode = 'xr';
    document.body.classList.add('vr-active');
    this.onNotice?.({ message: 'Headset view — thumbstick to walk, point and hold to teleport.' });
  }

  async enterStereo() {
    const mk = (name, x) => { const c = new FreeCamera(name, Vector3.Zero(), this.scene); c.fov = this.camera.fov; c.minZ = this.camera.minZ; c.maxZ = this.camera.maxZ; c.inputs.clear(); c.viewport = new Viewport(x, 0, 0.5, 1); return c; };
    this.eyes = [mk('eyeL', 0), mk('eyeR', 0.5)];
    this.scene.activeCameras = this.eyes;
    for (const e of this.eyes) this.pipeline.pipeline.addCamera(e);
    this.mode = 'stereo';
    document.body.classList.add('vr-active');
    try { await document.documentElement.requestFullscreen?.(); } catch { /* not allowed; still works windowed */ }
    this.onNotice?.({ message: 'Side-by-side view for a phone headset. Press Esc to come back.' });
    this.escape = (e) => { if (e.code === 'Escape' && this.mode === 'stereo') this.exit(); };
    window.addEventListener('keydown', this.escape);
  }

  async exit() {
    const mode = this.mode;
    this.mode = null; // first, before any await: the render loop keeps running through this
    document.body.classList.remove('vr-active');
    if (mode === 'xr') { try { await this.xr.baseExperience.exitXRAsync(); } catch { /* already gone */ } }
    if (mode === 'stereo') {
      window.removeEventListener('keydown', this.escape);
      for (const e of this.eyes) { this.pipeline.pipeline.removeCamera(e); e.dispose(); }
      this.eyes = null;
      this.scene.activeCameras = null;
      this.scene.activeCamera = this.camera;
      try { if (document.fullscreenElement) await document.exitFullscreen(); } catch { /* ignore */ }
    }
    this.onNotice?.({ type: 'exited' });
  }

  // Called every frame AFTER the flat camera has been synced from three.
  update() {
    if (this.mode !== 'stereo') return;
    const right = this.camera.getDirection(new Vector3(1, 0, 0));
    const target = this.camera.getTarget();
    this.eyes.forEach((eye, i) => {
      const off = right.scale((i === 0 ? -1 : 1) * EYE_SEPARATION * 0.5);
      eye.position.copyFrom(this.camera.position.add(off));
      eye.setTarget(target.add(off));
    });
  }

  render() { return false; }
  resize() {}
}
