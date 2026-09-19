// Sky, sun, image-based lighting and atmosphere -- everything that is "the weather".
//
// The main app's environment is a flat background colour, linear fog, one hemisphere light
// and one directional light. HiFi replaces all four with things that are derived from ONE
// description of the sky:
//
//   * a procedural sky dome (gradient atmosphere, a real sun disc with a Mie-style glow,
//     lit fbm cloud decks that drift, stars that come out as the sun goes down);
//   * a reflection probe that photographs that dome into a cube map, which becomes
//     scene.environmentTexture -- so every PBR surface in the world is lit and reflects the
//     sky that is actually overhead, at the time of day it actually is;
//   * a sun whose colour and strength follow its elevation, so a slider from noon to dusk
//     moves the light through white -> gold -> ember rather than just dimming it;
//   * exponential-squared fog whose colour is sampled from the same horizon the dome draws,
//     so distant hills fade INTO the sky instead of into a colour that merely resembles it.
//
// One description, used four times, is what keeps them from drifting apart.

import {
  Color3, Vector3, MeshBuilder, ShaderMaterial, Effect, DirectionalLight, HemisphericLight,
  ReflectionProbe, Scene, Constants, SphericalHarmonics, SphericalPolynomial,
} from '@babylonjs/core';

Effect.ShadersStore.hifiSkyVertexShader = `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vDir;
void main(void) {
  vDir = position;
  vec4 p = worldViewProjection * vec4(position, 1.0);
  gl_Position = p.xyww; // pin to the far plane
}`;

Effect.ShadersStore.hifiSkyFragmentShader = `
precision highp float;
varying vec3 vDir;
uniform vec3 sunDir;
uniform vec3 zenithColor;
uniform vec3 horizonColor;
uniform vec3 groundColor;
uniform vec3 sunColor;
uniform vec3 cloudLit;
uniform vec3 cloudShade;
uniform float cloudCover;
uniform float cloudScale;
uniform float haze;
uniform float starAmount;
uniform float sunDisc;
uniform float time;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0; float a = 0.5;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 6; i++) { s += a * noise(p); p = r * p * 2.03; a *= 0.5; }
  return s;
}
float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }

float cloudDensity(vec2 uv, float cover) {
  float n = fbm(uv);
  // A second, much broader field breaks the deck into weather: banks and clearings rather
  // than one even scatter of identical puffs from horizon to horizon.
  float broad = fbm(uv * 0.23 + 7.1);
  float c = n * 0.72 + broad * 0.42;
  return smoothstep(1.0 - cover, 1.0 - cover + 0.32, c);
}

void main(void) {
  vec3 dir = normalize(vDir);
  float up = dir.y;
  float sunDot = clamp(dot(dir, sunDir), 0.0, 1.0);

  // Atmosphere. The exponent keeps the pale band tight to the horizon, the way a clear
  // sky actually is, and haze widens it.
  float h = pow(clamp(up, 0.0, 1.0), mix(0.62, 0.34, haze));
  vec3 sky = mix(horizonColor, zenithColor, h);

  // Forward scatter: the sky brightens and warms toward the sun, far more so when the sun
  // is low and the light has crossed a lot of air.
  float low = 1.0 - clamp(sunDir.y * 2.2, 0.0, 1.0);
  sky += sunColor * (pow(sunDot, 6.0) * 0.16 + pow(sunDot, 48.0) * 0.4) * (0.4 + low * 1.4) * (0.3 + haze);

  // Sun disc with a soft limb.
  float disc = smoothstep(0.99962, 0.99988, sunDot) * sunDisc;
  vec3 col = sky;

  // Stars: a jittered cell lattice on the direction vector, twinkling slightly.
  if (starAmount > 0.001 && up > -0.05) {
    vec3 sp = dir * 210.0;
    vec3 cell = floor(sp);
    float r = hash3(cell);
    vec3 offs = vec3(hash3(cell + 1.7), hash3(cell + 5.3), hash3(cell + 9.1));
    float d = length(fract(sp) - offs);
    float star = smoothstep(0.16, 0.0, d) * step(0.965, r);
    float tw = 0.75 + 0.25 * sin(time * 2.0 + r * 90.0);
    vec3 tint = mix(vec3(0.75, 0.84, 1.0), vec3(1.0, 0.9, 0.75), hash3(cell + 3.3));
    col += tint * star * tw * starAmount * 2.4 * smoothstep(-0.05, 0.12, up);
  }

  // Clouds: two decks projected onto planes, lit by sampling density toward the sun.
  if (cloudCover > 0.01 && up > 0.0) {
    vec2 wind = vec2(time * 0.006, time * 0.0025);
    vec2 uv = dir.xz / (up + 0.11) * 0.62 * cloudScale + wind;
    float d = cloudDensity(uv, cloudCover);
    if (d > 0.001) {
      vec2 toSun = normalize(sunDir.xz + vec2(0.0001)) * 0.09;
      float dSun = cloudDensity(uv + toSun, cloudCover);
      float shade = clamp(d - dSun * 0.85 + 0.35, 0.0, 1.0);
      vec3 cc = mix(cloudShade, cloudLit, shade);
      // Silver lining: thin edges facing the sun glow.
      cc += sunColor * pow(sunDot, 10.0) * (1.0 - d) * 0.9;
      float fade = smoothstep(0.0, 0.16, up);
      col = mix(col, cc, d * fade * 0.94);
    }
    // High thin cirrus, stretched along the wind.
    vec2 uv2 = dir.xz / (up + 0.2) * vec2(0.22, 0.7) * cloudScale + wind * 0.4 + 31.7;
    float cir = smoothstep(0.52, 0.95, fbm(uv2 * 1.6)) * 0.34 * cloudCover;
    col = mix(col, cloudLit, cir * smoothstep(0.05, 0.4, up));
  }

  col += sunColor * disc * 40.0;

  // Below the horizon: fade to the ground/fog colour so far terrain has something to
  // dissolve into and the probe sees a sensible floor.
  if (up < 0.0) col = mix(col, groundColor, smoothstep(0.0, -0.08, up));

  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}`;

const lin = (hex) => Color3.FromHexString('#' + hex.toString(16).padStart(6, '0')).toLinearSpace();
const mix3 = (a, b, t) => new Color3(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t);
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

export class Environment {
  constructor(scene, quality) {
    this.scene = scene;
    this.theme = null;
    this.hour = 12;
    this.time = 0;
    this.probeDirty = 0;

    scene.clearColor.set(0, 0, 0, 1);
    scene.fogMode = Scene.FOGMODE_EXP2;

    this.sun = new DirectionalLight('sun', new Vector3(-0.5, -1, -0.3), scene);
    this.sun.shadowMinZ = 1;
    this.sun.shadowMaxZ = 900;

    // A hemisphere fill UNDER the image-based lighting, not instead of it. IBL from a probe
    // carries the colour of the sky beautifully and has no notion of bounce off the ground,
    // so the underside of everything would go to the probe's dark floor without this.
    this.fill = new HemisphericLight('fill', new Vector3(0, 1, 0), scene);
    this.fill.specular = Color3.Black();

    this.dome = MeshBuilder.CreateSphere('skyDome', { diameter: 2, segments: 24, sideOrientation: 1 }, scene);
    this.dome.infiniteDistance = true;
    this.dome.isPickable = false;
    this.dome.applyFog = false;
    this.dome.alwaysSelectAsActiveMesh = true;
    this.dome.renderingGroupId = 0;
    this.dome.scaling.setAll(20000);

    this.material = new ShaderMaterial('skyMat', scene, 'hifiSky', {
      attributes: ['position'],
      uniforms: ['worldViewProjection', 'sunDir', 'zenithColor', 'horizonColor', 'groundColor', 'sunColor', 'cloudLit',
        'cloudShade', 'cloudCover', 'cloudScale', 'haze', 'starAmount', 'sunDisc', 'time'],
    });
    this.material.backFaceCulling = false;
    this.material.disableDepthWrite = true;
    this.material.depthFunction = Constants.LEQUAL;
    this.dome.material = this.material;

    this.probe = new ReflectionProbe('skyProbe', quality.probe, scene, true, true, true);
    this.probe.renderList.push(this.dome);
    this.probe.refreshRate = 0; // render on demand
    this.probe.cubeTexture.gammaSpace = false;
    scene.environmentTexture = this.probe.cubeTexture;
    // The probe must not see the sun's DISC at full strength. The directional light already
    // supplies the sun's specular highlight; a 40x HDR dot in a box-filtered mip chain adds
    // a second one, as fireflies on every rough surface.
    this.probe.cubeTexture.onBeforeRenderObservable.add(() => this.material.setFloat('sunDisc', 0.02));
    this.probe.cubeTexture.onAfterRenderObservable.add(() => this.material.setFloat('sunDisc', this.discVisible));
    this.discVisible = 1;

    this.sunDir = new Vector3(0, 1, 0);
  }

  applyTheme(theme, hour = null) {
    this.theme = theme;
    this.setHour(hour);
  }

  // The main app's Time of Day control speaks in PHASE, 0..1, with its named moments at fixed
  // points on the scrub (sunrise 0.2, noon 0.5, sunset 0.72, night 0.92). Same knots here.
  setPhase(phase) {
    if (phase === null || phase === undefined) { this.setHour(null); return; }
    const knots = [[0, 3.5], [0.2, 6], [0.5, 13], [0.72, 20], [0.92, 22.5], [1, 24]];
    let hour = 12;
    for (let i = 1; i < knots.length; i++) {
      if (phase <= knots[i][0]) { const [p0, h0] = knots[i - 1]; const [p1, h1] = knots[i]; hour = h0 + ((phase - p0) / (p1 - p0)) * (h1 - h0); break; }
    }
    this.setHour(hour);
  }

  // hour: 0..24, or NULL for the world's own light -- the sun exactly where that world's theme
  // put it, which every main-app layout was composed around. Sunrise at 6, sunset at 20: a
  // long summer day, so the scrub spends most of its travel in usable daylight.
  setHour(hour) {
    this.hour = hour;
    const theme = this.theme;
    const fixed = theme.dark; // night and airless worlds keep their sky whatever the hour
    const home = theme.sunDir;
    const homeAz = Math.atan2(home[2], home[0]);
    let elevation; let az;
    if (hour === null || hour === undefined) {
      elevation = Math.asin(home[1]); az = homeAz;
    } else {
      const dayT = (hour - 6) / 14; // 0 sunrise .. 1 sunset
      elevation = Math.sin(clamp01(dayT) * Math.PI) * 1.12;
      if (dayT < 0 || dayT > 1) elevation = -Math.min(0.5, (dayT < 0 ? -dayT : dayT - 1) * 2.2);
      az = homeAz + (dayT - 0.6) * 2.4;
    }
    const ce = Math.cos(elevation);
    this.sunDir.set(Math.cos(az) * ce, Math.sin(elevation), Math.sin(az) * ce).normalize();
    const dayT = 0.5;
    theme.fixedSky = fixed;

    const day = sstep(-0.02, 0.22, elevation); // 0 night .. 1 full day
    // At the world's OWN hour nothing is recoloured: that light is what the theme specifies,
    // and a world with a low sun (the Taj at dawn) already carries it in its sky colour.
    const atHome = hour === null || hour === undefined;
    const golden = theme.fixedSky || atHome ? 0 : sstep(0.5, 0.02, elevation) * sstep(-0.12, 0.04, elevation);
    const night = 1 - sstep(-0.16, 0.02, elevation);

    const sky = theme.sky;
    let zenith = lin(sky.zenith);
    let horizon = lin(sky.horizon);
    const sunsetHorizon = lin(sky.sunsetTint ?? 0xff8a3c);
    const sunsetZenith = lin(0x33427a);
    const nightZenith = lin(0x02040a);
    const nightHorizon = lin(0x0a1424);
    zenith = mix3(zenith, sunsetZenith, golden * 0.75);
    horizon = mix3(horizon, sunsetHorizon, golden * 0.85);
    zenith = mix3(zenith, nightZenith, night);
    horizon = mix3(horizon, nightHorizon, night);

    // The sun reddens as it drops: more air in the way scatters the blue out of the beam.
    const white = lin(theme.sunColor);
    const ember = lin(0xff6a26);
    const gold = lin(0xffc070);
    let sunColor = mix3(white, gold, sstep(0.55, 0.18, elevation));
    sunColor = mix3(sunColor, ember, sstep(0.2, 0.0, elevation));
    if (theme.fixedSky || atHome) sunColor = white;

    // Direct light. At night a dim blue moon takes over from the opposite side so the world
    // keeps its shadows and its shape instead of going to a flat dark.
    const isNight = elevation < -0.02;
    const lightDir = isNight ? new Vector3(-this.sunDir.x, -Math.abs(this.sunDir.y) - 0.5, -this.sunDir.z).normalize() : this.sunDir.scale(-1);
    this.sun.direction.copyFrom(isNight ? lightDir : lightDir);
    this.sun.position.copyFrom(this.sun.direction.scale(-400));
    const sunStrength = theme.sunIntensity * sstep(-0.02, 0.3, elevation);
    this.sun.intensity = isNight ? 0.5 : Math.max(0.05, sunStrength);
    this.sun.diffuse = isNight ? lin(0x7f9bd8) : sunColor;
    this.sun.specular = this.sun.diffuse;

    const fillLevel = theme.ambientIntensity * (0.12 + 0.88 * day);
    this.fill.intensity = fillLevel;
    this.fill.diffuse = mix3(mix3(horizon, zenith, 0.4), Color3.White(), 0.35);
    this.groundBounce = lin(theme.hemiGround ?? theme.hills?.tint ?? 0x555555);
    this.fill.groundColor = mix3(this.groundBounce, horizon, 0.35).scale(0.55);

    this.scene.environmentIntensity = theme.envIntensity * (0.1 + 0.9 * day);

    // Fog takes the horizon's colour, pulled a little toward the sun's when it is low.
    const fog = mix3(horizon, sunColor, golden * 0.25);
    this.scene.fogColor = new Color3(Math.pow(fog.r, 1 / 2.2), Math.pow(fog.g, 1 / 2.2), Math.pow(fog.b, 1 / 2.2));
    this.scene.fogDensity = theme.fogDensity * (1 + golden * 0.8);
    this.scene.fogEnabled = theme.fogDensity > 0;
    this.fogLinear = fog;

    const cloudLit = mix3(lin(sky.cloudTint ?? 0xffffff), sunColor, 0.35 + golden * 0.5)
      .scale((0.35 + 0.95 * day) * (1 + golden * 0.25));
    const cloudShade = mix3(zenith, horizon, 0.55).scale(0.62 + 0.2 * day);

    const m = this.material;
    m.setVector3('sunDir', this.sunDir);
    m.setColor3('zenithColor', zenith);
    m.setColor3('horizonColor', horizon);
    m.setColor3('groundColor', fog);
    m.setColor3('sunColor', sunColor.scale(0.6 + 0.4 * day));
    m.setColor3('cloudLit', cloudLit);
    m.setColor3('cloudShade', cloudShade);
    m.setFloat('cloudCover', sky.cloudCover);
    m.setFloat('cloudScale', sky.cloudScale);
    m.setFloat('haze', sky.haze);
    m.setFloat('starAmount', Math.max(sky.stars, night));
    this.discVisible = elevation > -0.03 && theme.sky.sunDisc !== false ? 1 : 0;
    m.setFloat('sunDisc', this.discVisible);

    this.elevation = elevation;
    this.dayAmount = day;
    // How far lamps and lit windows are up: fully, in any world that is dark by design.
    this.lampAmount = theme.dark ? 1 : 1 - day;
    this.nightAmount = night;
    this.goldenAmount = golden;
    this.sunColorLinear = sunColor;
    this.probeDirty = 3; // re-photograph the sky over the next few frames
    this.updateIrradiance(zenith, horizon, fog, sunColor, day);
    this.onChange?.(this);
  }

  update(dt) {
    this.time += dt;
    this.material.setFloat('time', this.time);
    // Clouds drift, so the probe is refreshed on a slow clock as well as on demand.
    this.probeClock = (this.probeClock ?? 0) + dt;
    if (this.probeClock > 20) { this.probeClock = 0; this.probeDirty = Math.max(this.probeDirty, 1); }
    if (this.probeDirty > 0) {
      this.probeDirty--;
      this.probe.cubeTexture.resetRefreshCounter();
    }
  }

  // Diffuse image-based light, as spherical harmonics computed HERE rather than read back
  // from the probe. Babylon's own path reads the cube's pixels off the GPU, which for a
  // float render target never resolves on some drivers -- and an unresolved promise does
  // not degrade, it blocks every PBR material in the scene from ever becoming ready, so the
  // symptom is a world with a sky and nothing else in it. The sky is an analytic function
  // of five colours, so sampling that function directly is exact, instant and portable.
  updateIrradiance(zenith, horizon, ground, sunColor, day) {
    const sh = new SphericalHarmonics();
    const N = 16;
    const dir = new Vector3();
    const haze = this.theme.sky.haze;
    const cover = this.theme.sky.cloudCover;
    const delta = (4 * Math.PI) / (N * N * 2);
    for (let j = 0; j < N; j++) {
      const y = 1 - (2 * (j + 0.5)) / N;
      const r = Math.sqrt(1 - y * y);
      for (let i = 0; i < N * 2; i++) {
        const a = ((i + 0.5) / (N * 2)) * Math.PI * 2;
        dir.set(Math.cos(a) * r, y, Math.sin(a) * r);
        let c;
        if (y >= 0) {
          const h = Math.pow(y, 0.62 + (0.34 - 0.62) * haze);
          c = mix3(horizon, zenith, h);
          // Clouds brighten the dome on average; fold their cover in as a flat lift.
          c = mix3(c, mix3(horizon, Color3.White(), 0.5).scale(0.4 + 0.6 * day), cover * 0.45);
          const sd = Math.max(0, Vector3.Dot(dir, this.sunDir));
          c = c.add(sunColor.scale(Math.pow(sd, 6) * 0.35));
        } else {
          // The lower hemisphere stands in for light bounced off the ground.
          c = mix3(ground, this.groundBounce ?? ground, 0.6).scale(0.45);
        }
        sh.addLight(dir, c, delta);
      }
    }
    sh.convertIncidentRadianceToIrradiance();
    sh.convertIrradianceToLambertianRadiance();
    this.probe.cubeTexture.sphericalPolynomial = SphericalPolynomial.FromHarmonics(sh);
  }
}
