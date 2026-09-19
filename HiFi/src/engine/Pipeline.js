// Shadows and post-processing: the half of "better lighting" that is not the lights.
//
//   * CASCADED shadow maps. The main app has one ortho shadow box over the whole world, so a
//     bench's shadow and a mountain's share the same texels. Cascades spend a full map on
//     the first thirty feet and coarser ones further out, which is what gives leaf-scale
//     shadow detail at the student's feet AND a shadowed hillside in the same frame.
//   * SSAO, for the contact shadow under everything that a shadow map is too coarse to draw.
//   * An HDR pipeline: MSAA, bloom off the genuinely bright things (sun glints, lamp glass,
//     water highlights), ACES tone mapping so highlights roll off instead of clipping, and a
//     colour grade with the saturation pushed -- "more vibrant" is a grading decision, and
//     doing it here rather than in every albedo keeps materials physically plausible.

import {
  CascadedShadowGenerator, DefaultRenderingPipeline, SSAO2RenderingPipeline, ImageProcessingConfiguration,
  ColorCurves, Color4, GlowLayer,
} from '@babylonjs/core';

export class Pipeline {
  constructor(scene, camera, sun, quality) {
    this.scene = scene;
    this.camera = camera;
    this.quality = quality;

    const shadows = new CascadedShadowGenerator(quality.shadowSize, sun);
    shadows.numCascades = quality.cascades;
    shadows.lambda = 0.88;
    // How far shadows reach is the single biggest cost in a wooded world: every caster inside
    // it is drawn again per cascade. Beyond this distance haze has taken most of the
    // contrast out of a shadow anyway.
    shadows.shadowMaxZ = quality.shadowDistance;
    shadows.stabilizeCascades = true;
    shadows.autoCalcDepthBounds = false;
    shadows.cascadeBlendPercentage = 0.08;
    shadows.depthClamp = true;
    shadows.usePercentageCloserFiltering = true;
    shadows.filteringQuality = CascadedShadowGenerator.QUALITY_HIGH;
    shadows.bias = 0.0035;
    shadows.normalBias = 0.012;
    shadows.darkness = 0.0;
    shadows.transparencyShadow = true;
    shadows.enableSoftTransparentShadow = false;
    this.shadows = shadows;

    const p = new DefaultRenderingPipeline('hifi', true, scene, [camera]);
    p.samples = quality.msaa;
    p.fxaaEnabled = true;
    p.bloomEnabled = true;
    p.bloomThreshold = 0.92;
    p.bloomWeight = 0.22;
    p.bloomKernel = 96;
    p.bloomScale = 0.5;
    p.sharpenEnabled = true;
    p.sharpen.edgeAmount = 0.18;
    p.sharpen.colorAmount = 1;
    p.imageProcessingEnabled = true;
    const ip = p.imageProcessing;
    ip.toneMappingEnabled = true;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    ip.vignetteEnabled = true;
    ip.vignetteWeight = 0.7;
    ip.vignetteStretch = 0.4;
    ip.vignetteColor = new Color4(0, 0, 0, 0);
    ip.colorCurvesEnabled = true;
    ip.colorCurves = new ColorCurves();
    this.pipeline = p;

    if (quality.ssao) {
      const ssao = new SSAO2RenderingPipeline('ssao', scene, { ssaoRatio: 0.5, blurRatio: 1 }, [camera]);
      ssao.radius = 2.2;
      ssao.totalStrength = 1.15;
      ssao.base = 0.08;
      ssao.samples = 16;
      ssao.maxZ = 400;
      ssao.minZAspect = 0.4;
      ssao.expensiveBlur = true;
      this.ssao = ssao;
    }

    // Emissive surfaces (lamp glass, lit windows, signs at night) bleed light.
    this.glow = new GlowLayer('glow', scene, { mainTextureRatio: 0.5, blurKernelSize: 48 });
    this.glow.intensity = 0.7;
  }

  applyTheme(theme) {
    const ip = this.pipeline.imageProcessing;
    ip.exposure = theme.exposure * 1.0;
    ip.contrast = theme.contrast;
    ip.colorCurves.globalSaturation = theme.saturation;
    ip.colorCurves.shadowsSaturation = theme.saturation * 0.5;
    ip.colorCurves.highlightsSaturation = -8;
  }

  addCaster(mesh) { this.shadows.addShadowCaster(mesh, true); }
  removeCaster(mesh) { this.shadows.removeShadowCaster(mesh, true); }
}
