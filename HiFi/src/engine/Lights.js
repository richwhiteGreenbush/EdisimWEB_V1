// Point lights. Babylon's forward renderer gives each mesh its four nearest lights, which is
// no use for a terrain that is ONE mesh under a dozen lamp posts. A clustered light container
// bins point lights into screen tiles instead, so every lamp and every orb in a world can be
// lit at once and the cost follows how many lights touch a pixel, not how many exist.
//
// Lights come and go at runtime -- a student drops an orb, a program duplicates one -- so the
// container takes them one at a time. `always` is the fraction of full strength a light keeps
// in daylight: a native lamp post is 0 (off at noon, up through dusk), a mirrored main-app
// light is 1 (those worlds were lit by their orbs at every hour, interiors especially).

import { PointLight, ClusteredLightContainer } from '@babylonjs/core';
import { linear } from '../props/Kit.js';

export class Lights {
  constructor(scene) {
    this.scene = scene;
    this.lights = new Map();
    this.night = 0;
    this.container = null;
    this.fallback = false;
  }

  ensureContainer() {
    if (this.container || this.fallback) return;
    try {
      this.container = new ClusteredLightContainer('lamps', [], this.scene);
      this.container.maxRange = 70;
    } catch (err) {
      console.warn('clustered lighting unavailable; falling back to nearest-four', err);
      this.fallback = true;
    }
  }

  add(position, { color = 0xffd9a0, intensity = 60, range = 38, always = 0 } = {}) {
    const light = new PointLight(`lamp${this.lights.size}`, position.clone(), this.scene);
    light.diffuse = linear(color);
    light.specular = light.diffuse;
    light.range = range;
    this.lights.set(light, { intensity, always });
    light.intensity = intensity * Math.max(always, this.night);
    this.ensureContainer();
    if (this.container && ClusteredLightContainer.IsLightSupported(light)) {
      try { this.container.addLight(light); } catch { /* stays a plain scene light */ }
    }
    return light;
  }

  remove(light) {
    if (!this.lights.has(light)) return;
    this.lights.delete(light);
    try { this.container?.removeLight(light); } catch { /* not in the container */ }
    light.dispose();
  }

  clear() { for (const light of [...this.lights.keys()]) this.remove(light); }

  setNight(amount) {
    this.night = amount;
    for (const [light, l] of this.lights) light.intensity = l.intensity * Math.max(l.always, amount);
  }
}
