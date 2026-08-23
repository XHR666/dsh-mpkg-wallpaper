// 自动生成：液态玻璃单一 bundle（build-lg-bundle.mjs），勿手改

// ===== shaders.js =====
// GLSL sources for the Liquid Glass replica.

const VS_FULLSCREEN = `#version 300 es
in vec2 aPos;
out vec2 vUV;
void main() {
  vUV = aPos;
  gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0);
}`;

// Vertex shader for one glass element: expands the unit quad to the element's
// bounding box (plus padding for the drop shadow) in pixel space.
const VS_GLASS = `#version 300 es
in vec2 aPos;
uniform vec2 uRes;
uniform vec2 uCenter;
uniform vec2 uHalf;
uniform float uPad;
out vec2 vUV;
void main() {
  vec2 half2 = uHalf + uPad;
  vec2 px = uCenter + (aPos * 2.0 - 1.0) * half2;
  vUV = px / uRes;
  gl_Position = vec4(px / uRes * 2.0 - 1.0, 0.0, 1.0);
}`;

const FS_BLIT = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
out vec4 outColor;
vec3 linearToSrgb(vec3 c) {
  c = max(c, 0.0);
  return mix(1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055,
             12.92 * c,
             lessThanEqual(c, vec3(0.0031308)));
}
void main() { outColor = vec4(linearToSrgb(texture(uTex, vUV).rgb), 1.0); }`;

// Dual-filter downsample (13 tap) used to build a progressively blurred mip
// chain. Sampling that chain with textureLod() gives a cheap variable blur,
// which is the "frosted"/scattering part of the material.
const FS_DOWN = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform vec2 uTexel;   // texel size of the SOURCE level
out vec4 outColor;
void main() {
  vec2 t = uTexel;
  vec4 a = texture(uTex, vUV) * 0.125;
  vec4 b = (texture(uTex, vUV + vec2(-t.x, -t.y)) +
            texture(uTex, vUV + vec2( t.x, -t.y)) +
            texture(uTex, vUV + vec2(-t.x,  t.y)) +
            texture(uTex, vUV + vec2( t.x,  t.y))) * 0.125;
  vec4 c = (texture(uTex, vUV + vec2(-2.0 * t.x, 0.0)) +
            texture(uTex, vUV + vec2( 2.0 * t.x, 0.0)) +
            texture(uTex, vUV + vec2(0.0, -2.0 * t.y)) +
            texture(uTex, vUV + vec2(0.0,  2.0 * t.y))) * 0.0625;
  vec4 d = (texture(uTex, vUV + vec2(-2.0 * t.x, -2.0 * t.y)) +
            texture(uTex, vUV + vec2( 2.0 * t.x, -2.0 * t.y)) +
            texture(uTex, vUV + vec2(-2.0 * t.x,  2.0 * t.y)) +
            texture(uTex, vUV + vec2( 2.0 * t.x,  2.0 * t.y))) * 0.03125;
  // RGB stores radiance. Alpha stores normalized optical density, so the mip
  // chain can blur both representations with exactly the same footprint.
  outColor = a + b + c + d;
}`;

// Bloom-style tent reconstruction. Each level combines its own downsampled
// detail with a tent-filtered version of the next coarser reconstructed level.
// The resulting chain removes the block boundaries that a downsample-only mip
// pyramid exposes when wide blur moves over high-contrast content.
const FS_UP = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uLow;
uniform sampler2D uHigh;
uniform vec2 uLowTexel;
out vec4 outColor;
void main() {
  vec2 t = uLowTexel;
  vec4 low = texture(uLow, vUV) * 4.0;
  low += (texture(uLow, vUV + vec2( t.x, 0.0)) +
          texture(uLow, vUV + vec2(-t.x, 0.0)) +
          texture(uLow, vUV + vec2(0.0,  t.y)) +
          texture(uLow, vUV + vec2(0.0, -t.y))) * 2.0;
  low += texture(uLow, vUV + vec2( t.x,  t.y)) +
         texture(uLow, vUV + vec2(-t.x,  t.y)) +
         texture(uLow, vUV + vec2( t.x, -t.y)) +
         texture(uLow, vUV + vec2(-t.x, -t.y));
  low *= 1.0 / 16.0;
  vec4 high = texture(uHigh, vUV);
  outColor = mix(high, low, 0.65);
}`;

// Procedural wallpapers. They only exist to give the glass something with hard,
// high contrast edges to bend -- exactly what the reference screenshots have.
const FS_WALLPAPER = `#version 300 es
precision highp float;
in vec2 vUV;
uniform vec2 uRes;
uniform int uScene;
uniform float uZoom;
uniform sampler2D uWallpaper;
uniform int uUseImage;
out vec4 outColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 srgbToLinear(vec3 c) {
  bvec3 cutoff = lessThanEqual(c, vec3(0.04045));
  vec3 low = c / 12.92;
  vec3 high = pow((c + 0.055) / 1.055, vec3(2.4));
  return mix(high, low, cutoff);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.02; a *= 0.5; }
  return s;
}
// distance to a quadratic bezier (iterative, good enough for a backdrop)
float sdBezier(vec2 p, vec2 a, vec2 b, vec2 c) {
  float best = 1e9;
  vec2 prev = a;
  for (int i = 1; i <= 40; i++) {
    float t = float(i) / 40.0;
    vec2 q = mix(mix(a, b, t), mix(b, c, t), t);
    vec2 pa = p - prev, ba = q - prev;
    float u = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0);
    best = min(best, length(pa - ba * u));
    prev = q;
  }
  return best;
}

vec3 sunsetBranches(vec2 uv) {
  // dusk gradient: cool grey-mauve at the top, warm amber near the horizon
  vec3 top = vec3(0.62, 0.55, 0.55);
  vec3 mid = vec3(0.85, 0.63, 0.53);
  vec3 low = vec3(0.94, 0.70, 0.52);
  vec3 col = mix(mid, top, smoothstep(0.45, 1.0, uv.y));
  col = mix(col, low, smoothstep(0.45, 0.0, uv.y));
  col += (fbm(uv * 3.0) - 0.5) * 0.05;

  vec2 p = uv * vec2(uRes.x / uRes.y, 1.0);
  float sc = uRes.x / uRes.y;
  vec3 bark = vec3(0.17, 0.10, 0.09);
  // main trunk + a few branches, thick and dark like the reference photo
  float d = sdBezier(p, vec2(0.42 * sc, -0.1), vec2(0.52 * sc, 0.45), vec2(0.36 * sc, 1.1));
  float m = smoothstep(0.060, 0.040, d);
  d = sdBezier(p, vec2(0.40 * sc, 0.30), vec2(0.62 * sc, 0.44), vec2(0.95 * sc, 0.26));
  m = max(m, smoothstep(0.034, 0.020, d));
  d = sdBezier(p, vec2(0.44 * sc, 0.62), vec2(0.25 * sc, 0.80), vec2(0.05 * sc, 0.72));
  m = max(m, smoothstep(0.022, 0.010, d));
  d = sdBezier(p, vec2(0.46 * sc, 0.80), vec2(0.72 * sc, 0.95), vec2(1.05 * sc, 0.78));
  m = max(m, smoothstep(0.016, 0.007, d));
  d = sdBezier(p, vec2(0.12 * sc, -0.05), vec2(0.18 * sc, 0.5), vec2(0.06 * sc, 1.05));
  m = max(m, smoothstep(0.038, 0.022, d));
  // seed pods
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 c = vec2((0.14 + 0.02 * fi) * sc, 0.30 + 0.26 * fi);
    m = max(m, smoothstep(0.035, 0.022, length((p - c) * vec2(1.0, 0.8))));
  }
  return mix(col, bark, m * 0.94);
}

vec3 deepBlueCity(vec2 uv) {
  vec3 col = mix(vec3(0.06, 0.14, 0.55), vec3(0.02, 0.06, 0.34), smoothstep(0.0, 1.0, uv.y));
  col += (fbm(uv * vec2(90.0, 90.0)) - 0.5) * 0.05;   // fabric-like dither
  // bright vertical tower strip
  float x = abs(uv.x - 0.5);
  float tower = smoothstep(0.035, 0.012, x) * smoothstep(0.02, 0.25, uv.y);
  col = mix(col, vec3(0.72, 0.58, 0.52), tower * 0.85);
  float glow = smoothstep(0.16, 0.0, x) * smoothstep(0.0, 0.5, uv.y) * 0.18;
  col += vec3(0.5, 0.42, 0.36) * glow;
  col = mix(col, vec3(0.10, 0.14, 0.26), smoothstep(0.16, 0.02, uv.y));
  return col;
}

vec3 islandOcean(vec2 uv) {
  float ar = uRes.x / uRes.y;
  vec3 deep = vec3(0.03, 0.26, 0.52);
  vec3 shallow = vec3(0.20, 0.74, 0.82);
  float waves = fbm(vec2(uv.x * ar * 6.0, uv.y * 22.0) + 3.0);
  vec3 col = mix(deep, shallow, smoothstep(0.30, 0.78, waves * 0.7 + uv.y * 0.5));

  vec2 p = (uv - vec2(0.5, 0.40)) * vec2(ar, 1.0);
  float isl = (fbm(p * 2.2 + 11.0) - 0.5) * 0.34;
  float d = length(p * vec2(0.62, 1.25)) - (0.42 + isl);
  // shallow reef ring around the land
  col = mix(col, vec3(0.42, 0.86, 0.86), smoothstep(0.14, 0.03, d) * 0.75);
  col = mix(col, vec3(0.94, 0.90, 0.72), smoothstep(0.035, 0.0, d));        // beach
  vec3 jungle = mix(vec3(0.04, 0.26, 0.09), vec3(0.24, 0.55, 0.20),
                    fbm(p * 9.0 + 5.0));
  col = mix(col, jungle, smoothstep(0.005, -0.02, d));                      // jungle
  return col;
}

vec2 coverUV(vec2 uv) {
  vec2 imageSize = vec2(textureSize(uWallpaper, 0));
  float imageAspect = imageSize.x / max(imageSize.y, 1.0);
  float viewportAspect = uRes.x / max(uRes.y, 1.0);
  vec2 p = uv;
  if (imageAspect > viewportAspect) {
    float crop = (imageAspect / viewportAspect - 1.0) * 0.5;
    p.x = p.x * (1.0 - 2.0 * crop) + crop;
  } else {
    float crop = (viewportAspect / imageAspect - 1.0) * 0.5;
    p.y = p.y * (1.0 - 2.0 * crop) + crop;
  }
  return clamp(p, vec2(0.001), vec2(0.999));
}

void main() {
  vec2 uv = (vUV - 0.5) / max(uZoom, 0.01) + 0.5;
  vec3 col;
  if (uUseImage == 1) {
    // Wallpaper textures use SRGB8_ALPHA8, so texture() already returns linear
    // radiance here.
    col = texture(uWallpaper, coverUV(uv)).rgb;
  } else {
    // Procedural palette constants are authored as display/sRGB colours. The
    // SRGB render target expects linear shader output and encodes it on write.
    col = srgbToLinear(uScene == 0 ? sunsetBranches(uv)
                       : uScene == 1 ? deepBlueCity(uv)
                                     : islandOcean(uv));
  }
  // Beer-Lambert representation of backdrop darkness. A value of 4 optical
  // density units already corresponds to ~1.8% transmission, enough for the
  // near-black branches while retaining useful precision in RGBA8.
  float lum = max(dot(col, vec3(0.2126, 0.7152, 0.0722)), 0.018);
  float density = clamp(-log(lum) / 4.0, 0.0, 1.0);
  outColor = vec4(col, density);
}`;

// ---------------------------------------------------------------------------
// The material itself.
//
// 1. shape          : square/rect folder / exact capsule / exact circle SDF
// 2. thickness      : t = clamp(-d / bevel), height h(t) = a convex bevel
//                     profile -> flat plateau in the middle, steep rim
// 3. normal         : n = normalize(vec3(s * H/bevel * dh/dt * grad(d), 1))
//                     s = -1 -> MENISCUS rim (concave, like a liquid climbing
//                     the wall of a glass): normals lean inward, refraction
//                     pushes the sample point OUTWARD, so the surroundings get
//                     squeezed into the rim. This is the Apple signature.
//                     s = +1 -> convex lens rim: magnifies the interior instead.
// 4. refraction     : Snell (refract()) through that surface, screen-space
//                     displacement = R.xy / -R.z * optical path length
// 5. dispersion     : R/G/B refracted with slightly different IOR
// 6. scattering     : variable-radius blur (multi-tap disc on the blurred mip
//                     chain), strong on the plateau, weak on the rim
// 7. reflection     : Schlick-Fresnel environment + 2 specular lobes on the
//                     bevel -> the bright glass rim
// 8. shading        : saturation boost / tint / soft contact shadow
// ---------------------------------------------------------------------------
const FS_GLASS = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 outColor;

uniform sampler2D uSrc;      // blurred mip chain of the backdrop
uniform sampler2D uBlurSrc;  // tent-upsampled reconstruction chain
uniform vec2  uRes;
uniform vec2  uCenter;       // draw-group bounds centre, px (vertex quad only)
uniform vec2  uHalf;         // element half size, px
const int MAX_SHAPES = 16;
uniform int   uShapeCount;
uniform vec2  uShapeCenters[MAX_SHAPES];
uniform vec2  uShapeHalves[MAX_SHAPES];
uniform int   uShapeTypes[MAX_SHAPES]; // 0 square/rect, 1 capsule, 2 circle
uniform float uShapeRadii[MAX_SHAPES];
uniform float uMergeRadius;  // smooth-union reach, px
uniform float uSquircle;     // superellipse exponent (2 = circular corners)
uniform float uBevel;        // max width of the refracting rim, px
uniform float uHeight;       // max glass height / optical thickness, px
uniform float uSizeAdaptation;// 0 = absolute material lengths, 1 = fit small UI
uniform float uIOR;
uniform float uDispersion;
uniform float uBlurPlateau;  // blur radius in the middle, px
uniform float uBlurRim;      // blur radius at the rim, px
uniform float uOpticalDensity;// dark-detail preservation; 0 = linear radiance
uniform float uMips;         // number of levels in the blurred chain
uniform float uSpecular;
uniform float uSpecPower;
uniform float uHighlightAdapt;
uniform float uHighlightWidth;
uniform float uHighlightSharpness;
uniform float uHighlightBase;
uniform float uFresnel;
uniform float uSat;
uniform float uBright;
uniform float uTintAmount;
uniform vec3  uTintColor;
uniform float uTintAdapt;    // content-aware light/dark material polarity
uniform float uShadow;
uniform float uShadowSize;
uniform float uShadowOffset;
uniform vec2  uLightDir;
uniform float uEdgeLine;
uniform float uEdgeWidth;
uniform float uEdgeDark;
uniform float uRefractScale;
uniform float uMeniscus;     // 1 = concave meniscus rim, 0 = convex lens rim
uniform int   uDebug;        // 0 final, 1 thickness, 2 normals, 3 displacement

float sdSquircle(vec2 p, vec2 b, float r, float n) {
  vec2 q = abs(p) - b + r;
  vec2 m = max(q, 0.0) + 1e-5;
  float e = pow(pow(m.x, n) + pow(m.y, n), 1.0 / n);
  return min(max(q.x, q.y), 0.0) + e - r;
}

float sdPrimitive(vec2 p, vec2 halfSize, int shapeType, float radius) {
  if (shapeType == 2) {
    // Circle is invariant: layout cannot turn it into an ellipse.
    return length(p) - min(halfSize.x, halfSize.y);
  }
  if (shapeType == 1) {
    // Apple's capsule rule: end-cap radius is exactly half the short side.
    return sdSquircle(p, halfSize, min(halfSize.x, halfSize.y), 2.0);
  }
  // Square and rectangular folders share the same fixed-radius corner model;
  // only their bounding boxes differ. The default exponent is 2 per reference.
  return sdSquircle(p, halfSize, radius, max(uSquircle, 2.0));
}

// One distance field represents the complete component group. Because the
// normal is derived from this same field below, the meniscus, refraction and
// highlight bend continuously through the bridge instead of exposing two
// composited glass layers.
float sdAppleShape(vec2 px) {
  float nearest = 1e8;
  for (int i = 0; i < MAX_SHAPES; i++) {
    if (i >= uShapeCount) break;
    float next = sdPrimitive(px - uShapeCenters[i], uShapeHalves[i],
                             uShapeTypes[i], uShapeRadii[i]);
    nearest = min(nearest, next);
  }

  if (uMergeRadius < 0.01) return nearest;

  // Global exponential smooth-min is associative and C-infinity. Pairwise
  // polynomial unions are only C1 and become order-dependent with 3+ shapes;
  // their curvature boundaries show up as diagonal tears under sharp glass
  // highlights. 0.36 matches the polynomial union's depth at equal distances.
  float scale = max(uMergeRadius * 0.36, 0.01);
  float sum = 0.0;
  for (int i = 0; i < MAX_SHAPES; i++) {
    if (i >= uShapeCount) break;
    float next = sdPrimitive(px - uShapeCenters[i], uShapeHalves[i],
                             uShapeTypes[i], uShapeRadii[i]);
    sum += exp(-(next - nearest) / scale);
  }
  return nearest - scale * log(max(sum, 1e-6));
}

// Quintic tangent transition. Besides value and slope, its second derivative
// matches at both ends: f(0/1)=0/1, f'(0/1)=0/1, f''(0/1)=0. This lets a
// circular corner leave a straight side with zero curvature instead of the
// rounded-box SDF's abrupt 0 -> 1/r curvature jump.
float tangentTransition(float u) {
  return u * u * u * (6.0 - 8.0 * u + 3.0 * u * u);
}

vec2 primitiveOpticalGradient(vec2 p, vec2 halfSize,
                              int shapeType, float radius) {
  if (shapeType == 2) return normalize(p + 1e-6);

  float exponent = shapeType == 1 ? 2.0 : max(uSquircle, 2.0);
  float resolvedRadius = shapeType == 1
                       ? min(halfSize.x, halfSize.y) : radius;
  vec2 q = abs(p) - halfSize + resolvedRadius;
  vec2 direction;

  if (q.x > 0.0 && q.y > 0.0) {
    // Analytic Lp-corner normal. Exponents above 2 already approach the side
    // with zero curvature; blend out the circular-corner correction by n=3.
    vec2 lp = normalize(pow(q, vec2(exponent - 1.0)) + 1e-6);
    const float HALF_PI = 1.57079632679;
    const float TRANSITION_ANGLE = 0.43633231299; // 25 degrees at each tangent
    float angle = atan(q.y, q.x);
    float easedAngle = angle;
    if (angle < TRANSITION_ANGLE) {
      easedAngle = TRANSITION_ANGLE *
                   tangentTransition(angle / TRANSITION_ANGLE);
    } else if (angle > HALF_PI - TRANSITION_ANGLE) {
      float fromTop = (HALF_PI - angle) / TRANSITION_ANGLE;
      easedAngle = HALF_PI - TRANSITION_ANGLE *
                   tangentTransition(fromTop);
    }
    vec2 continuousCorner = vec2(cos(easedAngle), sin(easedAngle));
    float circularCorner = 1.0 - smoothstep(2.0, 3.0, exponent);
    direction = normalize(mix(lp, continuousCorner, circularCorner));
  } else if (q.x > q.y) {
    direction = vec2(1.0, 0.0);
  } else {
    direction = vec2(0.0, 1.0);
  }

  return direction * sign(p);
}

vec2 opticalGradient(vec2 px) {
  float nearest = 1e8;
  int nearestIndex = 0;
  for (int i = 0; i < MAX_SHAPES; i++) {
    if (i >= uShapeCount) break;
    float next = sdPrimitive(px - uShapeCenters[i], uShapeHalves[i],
                             uShapeTypes[i], uShapeRadii[i]);
    if (next < nearest) {
      nearest = next;
      nearestIndex = i;
    }
  }

  if (uMergeRadius < 0.01 || uShapeCount == 1) {
    return primitiveOpticalGradient(
      px - uShapeCenters[nearestIndex], uShapeHalves[nearestIndex],
      uShapeTypes[nearestIndex], uShapeRadii[nearestIndex]
    );
  }

  // The derivative of exponential smooth-min is the same weighted average of
  // the primitive derivatives. Reusing those weights keeps fused normals C2
  // through both a primitive's tangent and the union bridge.
  float scale = max(uMergeRadius * 0.36, 0.01);
  vec2 gradientSum = vec2(0.0);
  float weightSum = 0.0;
  for (int i = 0; i < MAX_SHAPES; i++) {
    if (i >= uShapeCount) break;
    vec2 local = px - uShapeCenters[i];
    float next = sdPrimitive(local, uShapeHalves[i],
                             uShapeTypes[i], uShapeRadii[i]);
    float weight = exp(-(next - nearest) / scale);
    gradientSum += primitiveOpticalGradient(
      local, uShapeHalves[i], uShapeTypes[i], uShapeRadii[i]
    ) * weight;
    weightSum += weight;
  }
  return gradientSum / max(weightSum, 1e-6);
}

// Shading adaptation belongs to the primitive under this fragment, not to the
// bounds of the whole draw group. The latter changes whenever any component in
// a connected fusion group moves, making every highlight pulse in sympathy.
//
// Around a genuine smooth-union bridge, use the same exponential influence as
// the distance field so the material centre crosses continuously from one
// primitive to the next. Contributions too weak to affect the visible bridge
// are smoothly discarded; a nearby-but-separate component then has exactly no
// influence on this component's highlight or light/dark tint.
void localComponentMetrics(vec2 px, out vec2 componentCenter,
                           out float componentShortSide) {
  float nearest = 1e8;
  vec2 nearestCenter = uShapeCenters[0];
  float nearestShortSide = 1.0;
  for (int i = 0; i < MAX_SHAPES; i++) {
    if (i >= uShapeCount) break;
    float next = sdPrimitive(px - uShapeCenters[i], uShapeHalves[i],
                             uShapeTypes[i], uShapeRadii[i]);
    if (next < nearest) {
      nearest = next;
      nearestCenter = uShapeCenters[i];
      nearestShortSide = 2.0 * min(uShapeHalves[i].x, uShapeHalves[i].y);
    }
  }

  componentCenter = nearestCenter;
  componentShortSide = nearestShortSide;
  if (uMergeRadius < 0.01 || uShapeCount == 1) return;

  float scale = max(uMergeRadius * 0.36, 0.01);
  vec2 centreSum = vec2(0.0);
  float shortSideSum = 0.0;
  float weightSum = 0.0;
  for (int i = 0; i < MAX_SHAPES; i++) {
    if (i >= uShapeCount) break;
    float next = sdPrimitive(px - uShapeCenters[i], uShapeHalves[i],
                             uShapeTypes[i], uShapeRadii[i]);
    float weight = exp(-(next - nearest) / scale);
    weight *= smoothstep(0.04, 0.20, weight);
    centreSum += uShapeCenters[i] * weight;
    shortSideSum += 2.0 * min(uShapeHalves[i].x, uShapeHalves[i].y) * weight;
    weightSum += weight;
  }
  if (weightSum > 0.0) {
    componentCenter = centreSum / weightSum;
    componentShortSide = shortSideSum / weightSum;
  }
}

vec4 sampleBg(vec2 px, float lod) {
  vec2 uv = clamp(px / uRes, vec2(0.001), vec2(0.999));
  return textureLod(uSrc, uv, lod);
}

vec4 sampleReconstructedBg(vec2 px, float lod) {
  vec2 uv = clamp(px / uRes, vec2(0.001), vec2(0.999));
  return textureLod(uBlurSrc, uv, lod);
}

float luminance(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 linearToSrgb(vec3 c) {
  c = max(c, 0.0);
  return mix(1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055,
             12.92 * c,
             lessThanEqual(c, vec3(0.0031308)));
}

vec2 softLimitOffset(vec2 offset, float limit) {
  float magnitude = length(offset);
  if (magnitude < 1e-4) return offset;
  float limited = tanh(magnitude / max(limit, 1.0)) * limit;
  return offset * (limited / magnitude);
}

// Variable-radius blur, radius in device px.
//
// A single textureLod() tap on the mip chain is not enough. The chain only
// offers radii in powers of two, and on the top levels one texel is tens of
// pixels wide, so a lone bilinear tap (a) averages in a huge slab of the
// screen, which drags the colour toward the frame mean -> washed out, and
// (b) reconstructs as a handful of big diamonds -> the "too few samples" mush.
// Instead take the level whose own radius is about a third of what we want and
// spread TAPS samples over the remainder on a golden-angle spiral. Neighbouring
// taps then land roughly one texel apart at that level, which is exactly the
// spacing at which the level's own filtering makes the disc continuous, so the
// result is a real wide Gaussian that keeps its local colour.
const int TAPS = 12;
const float GOLDEN_ANGLE = 2.39996323;

vec3 blurBg(vec2 px, float radius) {
  if (radius < 1.0) return sampleBg(px, 0.0).rgb;
  float lod = clamp(log2(radius) - 1.585, 0.0, uMips - 1.0);   // 2^lod ~ r/3
  vec3 acc = vec3(0.0);
  float densityAcc = 0.0;
  float wsum = 0.0;
  for (int i = 0; i < TAPS; i++) {
    float fi = float(i) + 0.5;
    float r  = sqrt(fi / float(TAPS));       // equal-area spacing over the disc
    float a  = fi * GOLDEN_ANGLE;
    float w  = exp(-1.8 * r * r);
    vec2 samplePx = px + vec2(cos(a), sin(a)) * r * radius;
    // Keep narrow blur faithful to the original downsample chain, then lean on
    // the reconstructed chain where coarse mip blocks and temporal breathing
    // become visible. Both samplers return linear radiance from sRGB textures.
    float reconstruction = 0.78 * smoothstep(10.0, 52.0, radius);
    vec4 s = mix(sampleBg(samplePx, lod),
                 sampleReconstructedBg(samplePx, lod), reconstruction);
    acc += s.rgb * w;
    densityAcc += s.a * w;
    wsum += w;
  }
  vec3 linearCol = acc / wsum;

  // A pure radiance average spreads a dark branch but also dilutes it toward
  // the pale sky. The density channel averages -log(luminance), equivalent to
  // geometrically averaging transmission. That preserves the visual weight of
  // dark occluders while keeping uniform light regions unchanged. We retain
  // the linear RGB hue and only restore the missing luminance contrast.
  float linearLum = max(dot(linearCol, vec3(0.2126, 0.7152, 0.0722)), 0.001);
  float densityLum = exp(-4.0 * densityAcc / wsum);
  float densityGap = max(linearLum - densityLum, 0.0);
  float radiusGate = smoothstep(1.0, 8.0, radius);
  float targetLum = max(linearLum * 0.22,
                        linearLum - densityGap * uOpticalDensity * radiusGate);
  return linearCol * (targetLum / linearLum);
}

void main() {
  vec2 px = vUV * uRes;

  float d = sdAppleShape(px);
  float aa = smoothstep(0.8, -0.8, d);
  vec2 adaptCenter;
  float localShortSide;
  localComponentMetrics(px, adaptCenter, localShortSide);
  // Material lengths are authored against the large demo components. Treat
  // them as maxima and fit the complete optical system to 30% of a smaller
  // primitive's short side. The shared metric call above also keeps this scale
  // continuous when differently sized primitives form one fused surface.
  float fittedScale = clamp(0.30 * localShortSide / max(uBevel, 1.0), 0.05, 1.0);
  float opticalScale = mix(1.0, fittedScale,
                           clamp(uSizeAdaptation, 0.0, 1.0));
  float bevel = max(uBevel * opticalScale, 1.0);
  float opticalHeight = uHeight * opticalScale;

  // ---- gradient of the SDF = outward direction of the surface -------------
  vec2 g = normalize(opticalGradient(px) + 1e-6);

  // ---- thickness field / bevel profile -----------------------------------
  float t  = clamp(-d / bevel, 0.0, 1.0);    // 0 at the edge, 1 on the plateau
  float ct = 1.0 - t;
  float h  = sqrt(max(1.0 - ct * ct, 0.0));  // convex (circular) bevel
  float dhdt = ct / max(h, 0.10);            // slope, clamped at the silhouette
  float slope = (opticalHeight / bevel) * dhdt;

  // 0 = convex lens, 1 = the default Apple-like concave rim. Values above 1
  // deliberately exaggerate the inward normal for exploratory tuning.
  float curveSign = 1.0 - 2.0 * uMeniscus;
  vec3 n = normalize(vec3(curveSign * g * slope, 1.0));
  vec3 I = vec3(0.0, 0.0, -1.0);

  // ---- refraction (Snell) + dispersion -----------------------------------
  float path = opticalHeight * mix(0.25, 1.0, h) * uRefractScale;
  vec2 dR, dG, dB;
  {
    float e = 1.0 / max(uIOR - uDispersion, 1.0);
    vec3 R = refract(I, n, e);
    dR = (R == vec3(0.0)) ? vec2(0.0) : R.xy / max(-R.z, 0.25) * path;
    e = 1.0 / max(uIOR, 1.0);
    R = refract(I, n, e);
    dG = (R == vec3(0.0)) ? vec2(0.0) : R.xy / max(-R.z, 0.25) * path;
    e = 1.0 / max(uIOR + uDispersion, 1.0);
    R = refract(I, n, e);
    dB = (R == vec3(0.0)) ? vec2(0.0) : R.xy / max(-R.z, 0.25) * path;
  }

  // Strong concave meniscus normals can make the screen-space mapping fold
  // over itself at multi-shape junctions. On hard-edged wallpapers that reads
  // as triangular tearing rather than refraction. Compress only the extreme
  // tail; ordinary offsets remain almost linear while caustic spikes stay
  // within a bevel-sized optical footprint.
  float maxDisplacement = max(1.15 * bevel, max(12.0 * opticalScale, 3.0));
  dR = softLimitOffset(dR, maxDisplacement);
  dG = softLimitOffset(dG, maxDisplacement);
  dB = softLimitOffset(dB, maxDisplacement);

  // ---- scattering: rim stays readable, plateau is frosted ----------------
  float radius = mix(uBlurRim, uBlurPlateau, smoothstep(0.0, 0.85, t))
               * opticalScale;

  vec3 col;
  col.r = blurBg(px + dR, radius).r;
  col.g = blurBg(px + dG, radius).g;
  col.b = blurBg(px + dB, radius).b;

  // Saturation is boosted on the TRANSMITTED backdrop only (this is what
  // UIVisualEffectView's saturationDeltaFactor does). Any wide blur averages
  // colours toward grey; without this the frosted panel reads pale even though
  // the wallpaper behind it is saturated. Doing it before the reflections keeps
  // the specular/Fresnel highlights neutral.
  col = mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, uSat);

  // ---- reflection: backdrop environment + narrow specular lobes -----------
  // Schlick: F0 for glass is ~4%, and the (1-cos)^5 falloff keeps the mirror
  // term confined to the steepest part of the bevel. A softer exponent smears
  // a grey wash across the whole rim and bleaches the refracted image there.
  float fres = 0.04 + 0.96 * pow(1.0 - n.z, 5.0);
  vec2 nn = normalize(n.xy + 1e-6);

  // Keep the reflected environment local to the fragment. Stabilise the lobe
  // controls around the owning primitive below so hard wallpaper edges do not
  // chop one rim into unrelated bright and dark pieces.
  float probeLod = clamp(3.5 + log2(max(opticalScale, 0.05)),
                         0.0, uMips - 1.0);
  float probeRadius = max(1.35 * bevel, max(18.0 * opticalScale, 3.0));
  vec3 envL = sampleBg(px + vec2(-probeRadius, 0.0), probeLod).rgb;
  vec3 envR = sampleBg(px + vec2( probeRadius, 0.0), probeLod).rgb;
  vec3 envB = sampleBg(px + vec2(0.0, -probeRadius), probeLod).rgb;
  vec3 envT = sampleBg(px + vec2(0.0,  probeRadius), probeLod).rgb;
  vec2 fallbackLight = normalize(uLightDir + vec2(1e-5));
  // Highlight adaptation must be stable across one component. Driving its
  // strength and colour from each fragment's probe makes a mountain ridge or
  // tree line cut the rim into bright and dark pieces. Probe around the local
  // component centre while retaining per-fragment environment reflection.
  vec3 adaptL = sampleBg(adaptCenter + vec2(-probeRadius, 0.0), probeLod).rgb;
  vec3 adaptR = sampleBg(adaptCenter + vec2( probeRadius, 0.0), probeLod).rgb;
  vec3 adaptB = sampleBg(adaptCenter + vec2(0.0, -probeRadius), probeLod).rgb;
  vec3 adaptT = sampleBg(adaptCenter + vec2(0.0,  probeRadius), probeLod).rgb;
  vec2 adaptGradient = vec2(luminance(adaptR) - luminance(adaptL),
                            luminance(adaptT) - luminance(adaptB));
  float stableContrast = length(adaptGradient);
  float lightAdapt = clamp(uHighlightAdapt, 0.0, 1.0) *
                     smoothstep(0.025, 0.22, stableContrast);
  // Keep the lobe direction material-local. Steering it with the wallpaper
  // gradient creates a rapidly rotating direction field around hard colour
  // edges, which appears as diagonal tears and lets unrelated components alter
  // each other's highlights. The environment still adapts strength and colour.
  vec2 lightDir = fallbackLight;

  // Reflect the colour seen in the surface-normal direction. A local sample
  // keeps small bright structures (tower lights, clouds, coastlines) attached
  // to the nearby rim instead of turning every frame into the same white ring.
  float wx = clamp(0.5 + 0.5 * nn.x, 0.0, 1.0);
  float wy = clamp(0.5 + 0.5 * nn.y, 0.0, 1.0);
  vec3 envX = mix(envL, envR, wx);
  vec3 envY = mix(envB, envT, wy);
  vec3 ringEnv = (envX * abs(nn.x) + envY * abs(nn.y)) /
                 max(abs(nn.x) + abs(nn.y), 1e-3);
  float localProbeLod = clamp(2.0 + log2(max(opticalScale, 0.05)),
                              0.0, uMips - 1.0);
  vec3 localEnv = sampleBg(px + g * max(0.55 * bevel,
                                        max(6.0 * opticalScale, 2.0)),
                           localProbeLod).rgb;
  vec3 env = mix(ringEnv, localEnv, 0.58);
  float envLum = luminance(env);
  env = mix(env, vec3(envLum), 0.10); // retain wallpaper hue, tame neon spikes
  float envStrength = mix(0.58, 1.0, smoothstep(0.08, 0.75, envLum));
  col = mix(col, env, clamp(fres * uFresnel * envStrength, 0.0, 0.82));

  vec3 L1 = normalize(vec3(lightDir, 0.58));
  vec3 L2 = normalize(vec3(-lightDir, 0.48));
  float sharpness = max(uHighlightSharpness, 0.1);
  float s1 = pow(max(dot(n, L1), 0.0),
                 max(uSpecPower * sharpness, 1.0));
  float s2 = pow(max(dot(n, L2), 0.0),
                 max(uSpecPower * sharpness * 0.78, 1.0)) * 0.18;
  float highlightWidth = clamp(uHighlightWidth, 0.16, 1.0);
  float riseEnd = min(0.10, 0.25 * highlightWidth);
  float specBand = smoothstep(0.015, riseEnd, t) *
                   (1.0 - smoothstep(0.61 * highlightWidth,
                                     highlightWidth, t));
  float baseHighlight = clamp(uHighlightBase, 0.0, 1.0);
  float sourceStrength = baseHighlight + (1.0 - baseHighlight) * lightAdapt;
  vec3 sourceEnv = mix(mix(adaptL, adaptR, 0.5 + 0.5 * lightDir.x),
                       mix(adaptB, adaptT, 0.5 + 0.5 * lightDir.y), 0.5);
  float sourceLum = max(luminance(sourceEnv), 0.08);
  vec3 specColor = clamp(mix(vec3(1.0), sourceEnv / sourceLum, 0.42),
                         vec3(0.45), vec3(2.2));
  col += uSpecular * (s1 + s2) * specBand * sourceStrength * specColor;

  // Dark contour right at the silhouette: at grazing angles the rim reflects
  // the surroundings instead of transmitting, so real glass edges read dark.
  float w = max(uEdgeWidth, 0.5);
  float contour = smoothstep(w, 0.0, abs(d + 0.55 * w));
  col *= 1.0 - uEdgeDark * contour;

  // Crisp inner highlight line; direction and colour follow the local probe.
  float line = smoothstep(1.35 * w, 0.0, abs(d + 2.2 * w));
  float lit = 0.26 + 0.74 * max(dot(g, lightDir), 0.0);
  vec3 stableEnv = (adaptL + adaptR + adaptB + adaptT) * 0.25;
  float stableEnvLum = max(luminance(stableEnv), 0.12);
  vec3 lineColor = mix(vec3(1.0), stableEnv / stableEnvLum, 0.28);
  col += uEdgeLine * line * lit * lineColor;

  // ---- tint --------------------------------------------------------------
  // Tint polarity adapts once per local component, not per draw group.
  // This captures the system-material light/dark switch without letting a hard
  // background edge split one surface into visibly different materials.
  float materialLum = luminance(sampleBg(adaptCenter, uMips - 1.0).rgb);
  float useDarkMaterial = smoothstep(0.38, 0.68, materialLum);
  vec3 automaticTint = mix(vec3(0.97, 0.985, 1.0),
                           vec3(0.035, 0.055, 0.080), useDarkMaterial);
  vec3 resolvedTint = mix(uTintColor, automaticTint, clamp(uTintAdapt, 0.0, 1.0));
  float adaptiveAmount = uTintAmount * mix(1.10, 0.92, useDarkMaterial);
  col = mix(col, resolvedTint, clamp(adaptiveAmount, 0.0, 1.0));
  col += uBright;

  // ---- soft contact shadow ----------------------------------------------
  float ds = sdAppleShape(px + vec2(0.0, uShadowOffset));
  float sh = exp(-max(ds, 0.0) / max(uShadowSize, 0.5)) * uShadow;

  if (uDebug == 1) col = vec3(h);
  if (uDebug == 2) col = vec3(0.5 + 0.5 * n.xy, n.z);
  if (uDebug == 3) col = vec3(length(dG) / max(opticalHeight, 1.0),
                              length(dR - dB) / max(opticalHeight, 1.0) * 6.0, 0.0);

  // The browser drawing buffer stores display/sRGB values, unlike the explicit
  // SRGB8_ALPHA8 offscreen attachments. Encode the final linear material here,
  // then add triangular-distribution noise smaller than one display-space LSB.
  if (uDebug == 0) {
    float n0 = hash12(gl_FragCoord.xy + vec2(17.0, 59.0));
    float n1 = hash12(gl_FragCoord.yx + vec2(83.0, 11.0));
    float noise = (n0 - n1) * (0.85 / 255.0);
    col = clamp(linearToSrgb(col) + noise, 0.0, 1.0);
  }

  float a = aa + sh * (1.0 - aa);
  outColor = vec4(col * aa, a);   // premultiplied; shadow contributes black
}`;


// ===== v2-shaders.js =====
// The V2 clear/transparent optical model. This is intentionally a separate
// shader rather than a branch inside FS_GLASS: its controls have different
// units, profiles and compositing rules even where a public name looks alike.
const FS_GLASS_V2 = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 outColor;

uniform sampler2D uSrc;
uniform vec2 uRes;
uniform float uDpr;
uniform float uMips;
const int MAX_SHAPES = 16;
uniform int uShapeCount;
uniform vec2 uShapeCenters[MAX_SHAPES];
uniform vec2 uShapeHalves[MAX_SHAPES];
uniform int uShapeTypes[MAX_SHAPES];
uniform float uShapeRadii[MAX_SHAPES];
uniform float uShapeTints[MAX_SHAPES];
uniform float uShapeTintLights[MAX_SHAPES];
uniform float uShapeFrosts[MAX_SHAPES];
uniform float uShapeOpacities[MAX_SHAPES];
uniform vec2 uLightDirs[MAX_SHAPES];
uniform float uRefraction;
uniform float uEdgeReach;
uniform float uEdgeWidth;
uniform float uDispersion;
uniform float uBody;
uniform float uAbsorption;
uniform float uRim;
uniform float uReflection;
uniform float uHighlight;
uniform float uEcho;
uniform float uHairline;
uniform float uHairWidth;

vec3 linearToSrgb(vec3 c) {
  c = max(c, 0.0);
  return mix(1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055,
             12.92 * c,
             lessThanEqual(c, vec3(0.0031308)));
}

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

float smoothUnion(float d1, float d2, float k) {
  float h = clamp(0.5 + 0.5 * (d2 - d1) / k, 0.0, 1.0);
  return mix(d2, d1, h) - k * h * (1.0 - h);
}

float shapeSdf(int index, vec2 point) {
  vec2 p = point - uShapeCenters[index];
  vec2 halfSize = uShapeHalves[index];
  int kind = uShapeTypes[index];
  float radius = min(uShapeRadii[index], min(halfSize.x, halfSize.y));
  if (kind == 0) return sdRoundBox(p, halfSize, radius);
  if (kind == 1) return sdRoundBox(p, halfSize, min(halfSize.x, halfSize.y));
  return length(p) - min(halfSize.x, halfSize.y);
}

vec2 opticalNormal(int index, vec2 point, vec2 sdfNormal) {
  vec2 p = point - uShapeCenters[index];
  vec2 halfSize = max(uShapeHalves[index], vec2(1.0));
  int kind = uShapeTypes[index];

  if (kind == 0) {
    // The sixth-order superellipse is the optical field, while roundness only
    // controls the silhouette. This separation is part of the V2 model.
    vec2 q = p / halfSize;
    vec2 g = vec2(sign(q.x) * pow(abs(q.x), 5.0) / halfSize.x,
                  sign(q.y) * pow(abs(q.y), 5.0) / halfSize.y);
    return normalize(g + sdfNormal * 0.0001);
  }
  if (kind == 1) {
    vec2 closest;
    if (halfSize.x >= halfSize.y) {
      float segment = max(halfSize.x - halfSize.y, 0.0);
      closest = vec2(clamp(p.x, -segment, segment), 0.0);
    } else {
      float segment = max(halfSize.y - halfSize.x, 0.0);
      closest = vec2(0.0, clamp(p.y, -segment, segment));
    }
    return normalize(p - closest + sdfNormal * 0.0001);
  }
  return normalize(p + sdfNormal * 0.0001);
}

vec3 backdrop(vec2 uv) {
  // The shared backdrop pipeline stores linear radiance in SRGB8_ALPHA8.
  // V2's optical constants were authored in display space, so convert each
  // sample back before applying the V2 equations.
  return linearToSrgb(texture(uSrc, clamp(uv, vec2(0.001), vec2(0.999))).rgb);
}

vec3 softBackdrop(vec2 uv, float radius) {
  float lod = clamp(log2(max(radius * 0.9, 1.0)), 0.0, max(uMips - 1.0, 0.0));
  vec2 r = vec2(max(radius * 0.42, 0.35)) / uRes;
  vec2 center = clamp(uv, vec2(0.001), vec2(0.999));
  vec3 c = linearToSrgb(textureLod(uSrc, center, lod).rgb) * 0.44;
  c += linearToSrgb(textureLod(uSrc, clamp(center + vec2(r.x, 0.0), vec2(0.001), vec2(0.999)), lod).rgb) * 0.14;
  c += linearToSrgb(textureLod(uSrc, clamp(center - vec2(r.x, 0.0), vec2(0.001), vec2(0.999)), lod).rgb) * 0.14;
  c += linearToSrgb(textureLod(uSrc, clamp(center + vec2(0.0, r.y), vec2(0.001), vec2(0.999)), lod).rgb) * 0.14;
  c += linearToSrgb(textureLod(uSrc, clamp(center - vec2(0.0, r.y), vec2(0.001), vec2(0.999)), lod).rgb) * 0.14;
  return c;
}

float luminance(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec3 interfaceColor(vec2 point, vec2 normal) {
  vec3 outsideColor = softBackdrop((point + normal * 1.8) / uRes, 2.0);
  vec3 insideColor = softBackdrop((point - normal * 1.8) / uRes, 2.0);
  // Apple's outer interface is a neutral contrast line rather than a copy of
  // the wallpaper colour. Include display-space value as well as luminance so
  // saturated blue/purple fields select a dark line even though their formal
  // luminance is modest. The outside carries more weight because that is the
  // field the silhouette must remain legible against.
  float outsideValue = max(outsideColor.r, max(outsideColor.g, outsideColor.b));
  float insideValue = max(insideColor.r, max(insideColor.g, insideColor.b));
  float outsideLight = max(luminance(outsideColor), outsideValue * 0.72);
  float insideLight = max(luminance(insideColor), insideValue * 0.72);
  float interfaceLight = outsideLight * 0.68 + insideLight * 0.32;
  float darkLine = smoothstep(0.40, 0.61, interfaceLight);
  return mix(vec3(0.92, 0.93, 0.96), vec3(0.014, 0.013, 0.018), darkLine);
}

void main() {
  vec2 point = vUV * uRes;
  int chosen = -1;
  float chosenD = 1e6;
  for (int i = 0; i < MAX_SHAPES; i++) {
    if (i >= uShapeCount) break;
    float d = shapeSdf(i, point);
    if (d <= 2.1) { chosen = i; chosenD = d; }
  }

  if (chosen < 0) {
    outColor = vec4(0.0);
    return;
  }

  vec2 center = uShapeCenters[chosen];
  vec2 halfSize = uShapeHalves[chosen];
  float minHalf = min(halfSize.x, halfSize.y);
  float e = 1.35;
  float dx = shapeSdf(chosen, point + vec2(e, 0.0)) - shapeSdf(chosen, point - vec2(e, 0.0));
  float dy = shapeSdf(chosen, point + vec2(0.0, e)) - shapeSdf(chosen, point - vec2(0.0, e));
  vec2 normal = normalize(vec2(dx, dy) + vec2(0.0001));
  float depth = clamp(-chosenD / max(12.0, minHalf * 0.62), 0.0, 1.0);
  float refractionSupport = max(14.0, minHalf * 0.50);
  float edgeCurve = pow(1.0 - smoothstep(0.0, refractionSupport, -chosenD), 2.2);
  vec2 local = (point - center) / max(halfSize, vec2(1.0));

  float edgeDepth = max(-chosenD, 0.0);
  float causticSupport = max(8.0, minHalf * uEdgeWidth);
  float captureX = clamp(edgeDepth / causticSupport, 0.0, 1.0);
  float causticT = 1.0 - smoothstep(0.0, causticSupport, edgeDepth);
  float causticShade = causticT * causticT * (3.0 - 2.0 * causticT);
  // The old double-smoothstep displacement flattened at the visible contour.
  // Its source-coordinate derivative therefore changed sign twice, making a
  // captured line turn back just before it touched the edge. A one-sided exit
  // profile keeps a finite slope at the contour and relaxes to zero only on
  // the inner side of the capture band, leaving a single optical fold.
  float captureProfile = pow(1.0 - captureX, 1.64);
  float refractionX = clamp(edgeDepth / refractionSupport, 0.0, 1.0);
  float refractionProfile = pow(1.0 - refractionX, 2.2);
  // The silhouette and optical superellipse deliberately differ in V2, but
  // the visible contour must still exit along the silhouette normal. Blend to
  // the broader optical field only after leaving the outer edge pixels.
  float opticalNormalMix = smoothstep(0.12, 0.55, captureX);
  vec2 bendNormal = normalize(mix(normal, opticalNormal(chosen, point, normal), opticalNormalMix));
  vec2 inward = -bendNormal;
  // Edge pull used to multiply Capture reach as a second public control. Keep
  // its original default as an internal calibration so the default material
  // retains the same displacement with one unambiguous capture parameter.
  const float CAPTURE_REACH_SCALE = 1.24;
  float captureDistance = uEdgeReach * CAPTURE_REACH_SCALE * captureProfile;
  float shallowRefraction = uRefraction * refractionProfile * 0.32;
  vec2 lensShift = inward * (shallowRefraction + captureDistance);
  lensShift += -local * (uRefraction * 0.035) * smoothstep(0.16, 0.92, depth);
  vec2 chromaShift = bendNormal * uDispersion * (0.32 + edgeCurve * 0.95);
  vec2 uvR = (point + lensShift * (1.0 + uDispersion * 0.009) + chromaShift) / uRes;
  vec2 uvG = (point + lensShift) / uRes;
  vec2 uvB = (point + lensShift * (1.0 - uDispersion * 0.011) - chromaShift) / uRes;
  // Reach controls where the sample comes from, not how fat a captured line
  // becomes. Preserve the tuned reach=35 softness while preventing larger
  // reaches from silently doubling the blur radius.
  float causticBlur = min(0.7 + 1.13 * uDpr, 0.7 + captureDistance * 0.026);
  // Frost is a ratio, not a fixed pixel radius. Resolve it against the
  // component's short side so a small icon stays clear while a larger card
  // naturally becomes denser and more opaque at the same material setting.
  float shapeFrost = clamp(uShapeFrosts[chosen], 0.0, 1.0);
  float shortSideCss = minHalf * 2.0 / max(uDpr, 1.0);
  float sizeRatio = clamp(shortSideCss / 96.0, 0.28, 2.25);
  float blurRadius = max(shapeFrost * shortSideCss
                         * (0.22 + depth * 0.55) * uDpr,
                         causticBlur);
  float blurMix = clamp(shapeFrost * (0.56 + sizeRatio * 0.34)
                        + causticShade * 0.18, 0.0, 0.88);
  vec3 sr = mix(backdrop(uvR), softBackdrop(uvR, blurRadius), blurMix);
  vec3 sg = mix(backdrop(uvG), softBackdrop(uvG, blurRadius), blurMix);
  vec3 sb = mix(backdrop(uvB), softBackdrop(uvB, blurRadius), blurMix);
  vec3 transmitted = vec3(sr.r, sg.g, sb.b);

  float transmittedLum = luminance(transmitted);
  vec3 bodyTarget = mix(vec3(0.030, 0.031, 0.038), vec3(0.94, 0.95, 0.97),
                        smoothstep(0.58, 0.82, transmittedLum));
  transmitted = mix(transmitted, bodyTarget,
                    clamp(uBody * (0.034 + edgeCurve * 0.012), 0.0, 0.11));
  transmitted = mix(vec3(luminance(transmitted)), transmitted, 1.0 - uBody * 0.045);

  float opticalPath = 0.26 + sqrt(depth) * 0.74;
  transmitted *= exp(-vec3(0.018, 0.011, 0.004) * opticalPath * 2.4 * uAbsorption);
  // Tinted Liquid Glass chooses one light/dark material for the whole
  // component. Choosing per fragment lets high-contrast content punch a
  // checkerboard through the surface instead of producing the coherent milky
  // veil used by notifications and other legibility-first controls.
  vec3 tintTarget = mix(vec3(0.055, 0.057, 0.066), vec3(0.975, 0.970, 0.955),
                        clamp(uShapeTintLights[chosen], 0.0, 1.0));
  float tintOpacity = smoothstep(0.0, 1.5, uShapeTints[chosen]) * 0.78;
  transmitted = mix(transmitted, tintTarget, tintOpacity * (0.88 + depth * 0.12));

  float mask = 1.0 - smoothstep(0.0, 1.35, chosenD);
  float thinRim = exp(-pow((chosenD + 0.65) / 1.4, 2.0));
  float innerRim = exp(-pow((chosenD + 6.2) / 3.8, 2.0));
  float fresnel = pow(clamp(edgeCurve, 0.0, 1.0), 0.72);
  // A softened environment probe keeps moving video/feed edges from turning
  // into one-frame white flashes while preserving the local colour response.
  vec3 reflected = softBackdrop((point + normal * (8.0 + uRefraction * 0.17)) / uRes, 5.2);
  vec3 adaptiveRim = reflected * 1.45 + vec3(0.06, 0.035, 0.08);
  adaptiveRim = mix(adaptiveRim, vec3(0.96, 0.97, 1.0), 0.24);
  adaptiveRim = mix(adaptiveRim, vec3(0.035, 0.025, 0.045),
                    smoothstep(0.78, 0.98, luminance(reflected)) * 0.48);

  vec2 lightDir = normalize(uLightDirs[chosen] + vec2(0.0001));
  float key = pow(max(dot(normal, lightDir), 0.0), 7.0) * fresnel;
  float opposite = pow(max(dot(normal, -lightDir), 0.0), 5.0) * innerRim;
  vec3 color = transmitted;
  color = mix(color, adaptiveRim,
              clamp((thinRim * 0.42 + innerRim * 0.18 + fresnel * 0.10)
                    * uRim * uReflection, 0.0, 0.72));
  color += vec3(1.0, 0.82, 0.92) * key * 0.30 * uRim * uHighlight;
  color *= 1.0 - opposite * 0.12 * uRim;
  float echo = exp(-pow((chosenD + 11.0) / 5.5, 2.0));
  vec3 echoColor = backdrop((point - normal * 11.0) / uRes);
  color = mix(color, echoColor * 1.12, echo * 0.075 * uRim * uEcho);

  float edgeAA = max(fwidth(chosenD), 0.72);
  float lineWidth = mix(0.34, 1.08, clamp(uHairWidth, 0.0, 1.0));
  float strokeDistance = abs(chosenD + 0.10) - lineWidth * 0.5;
  float hairline = 1.0 - smoothstep(-edgeAA * 0.72, edgeAA * 0.72, strokeDistance);
  vec3 hairColor = interfaceColor(point, normal);
  // The contrast line is the default interface. On the light-facing arc the
  // specular key replaces it with the thin white highlight visible in the
  // native material instead of merely brightening the black line underneath.
  float hairHighlight = clamp(key * uHighlight * 2.5 * (0.65 + uRim * 0.60), 0.0, 0.96);
  hairColor = mix(hairColor, vec3(0.985, 0.99, 1.0), hairHighlight);

  // Premultiplied layer composition exactly reproduces the prototype's two
  // sequential mixes when drawn over the supplied backdrop, and also allows
  // the same shader to work in overlay mode over a DOM/canvas backdrop.
  float hairAlpha = clamp(hairline * uHairline * (0.22 + uRim * 0.20), 0.0, 1.0);
  float alpha = hairAlpha + mask * (1.0 - hairAlpha);
  vec3 premultiplied = hairColor * hairAlpha + color * mask * (1.0 - hairAlpha);
  float surfaceOpacity = clamp(uShapeOpacities[chosen], 0.0, 1.0);
  outColor = vec4(premultiplied * surfaceOpacity, alpha * surfaceOpacity);
}`;


// ===== geometry.js =====
// CPU mirror of the shape maths in FS_GLASS.
//
// The shader is the source of truth for what the glass looks like, but callers
// also need the same geometry on the CPU: to know which component the pointer
// is over, and to split a large element list into groups that cannot influence
// each other. Keeping both in this module - free of any WebGL or DOM
// dependency - is what makes those rules unit-testable.
//
// Every length here is in the same unit as the element coordinates (CSS pixels
// for the public API). The renderer applies `dpr` separately.

// The glass shader carries the group in uniform arrays of this length.
const MAX_GLASS_SHAPES = 16;

// `sdGroup` weights each shape by exp(-(d - nearest) / scale). Past this many
// multiples of `scale` the contribution is below 1/3000 of a pixel of distance,
// which is far under the quantisation of the RGBA8 output. Shapes separated by
// more than that can be shaded in different draw calls without a visible seam.
const MERGE_INFLUENCE_SCALES = 8;

// Matches the shader: scale = max(mergeRadius * 0.36, 0.01).
const MERGE_SCALE_RATIO = 0.36;

// Apple's folder corner is capped at 23.5% of the short side.
const MAX_CORNER_RATIO = 0.235;

const SHAPE_TYPES = Object.freeze({ rect: 0, folder: 0, pill: 1, circle: 2 });

function shapeTypeOf(shape) {
  return SHAPE_TYPES[shape] ?? 0;
}

/** Corner radius the renderer will use for an element, before `dpr`. */
function cornerRadiusOf(element, materialRadius = 0) {
  const short = Math.min(element.w ?? element.width ?? 0, element.h ?? element.height ?? 0);
  return Math.min(element.radius ?? materialRadius, short * MAX_CORNER_RATIO);
}

/** Superellipse rounded box, mirroring `sdSquircle` in the glass shader. */
function sdSquircle(px, py, halfX, halfY, radius, exponent) {
  const qx = Math.abs(px) - halfX + radius;
  const qy = Math.abs(py) - halfY + radius;
  const mx = Math.max(qx, 0) + 1e-5;
  const my = Math.max(qy, 0) + 1e-5;
  const e = (mx ** exponent + my ** exponent) ** (1 / exponent);
  return Math.min(Math.max(qx, qy), 0) + e - radius;
}

/** Mirrors `sdPrimitive`: exact circle, exact capsule, or squircle folder. */
function sdPrimitive(px, py, halfX, halfY, shapeType, radius, squircle = 2) {
  if (shapeType === 2) return Math.hypot(px, py) - Math.min(halfX, halfY);
  if (shapeType === 1) return sdSquircle(px, py, halfX, halfY, Math.min(halfX, halfY), 2);
  return sdSquircle(px, py, halfX, halfY, radius, Math.max(squircle, 2));
}

function toShape(element, material) {
  const w = element.w ?? element.width ?? element.size ?? 0;
  const h = element.h ?? element.height ?? element.size ?? w;
  return {
    cx: (element.x ?? 0) + w / 2,
    cy: (element.y ?? 0) + h / 2,
    halfX: w / 2,
    halfY: h / 2,
    type: shapeTypeOf(element.shape),
    radius: cornerRadiusOf({ ...element, w, h }, material.radius ?? 0),
  };
}

/**
 * Signed distance to the fused silhouette of `elements`, in element
 * coordinates. Mirrors `sdAppleShape`, including the global exponential
 * smooth-min, so a hit test agrees with the pixels the shader produced.
 *
 * The smooth-min pulls the surface inward by at most `scale * ln(2)`, which is
 * a quarter of `mergeRadius`. A gap between two components therefore only
 * closes into a bridge while it is narrower than about `mergeRadius / 2`;
 * beyond that the fusion distance only softens the approach.
 */
function sdGroup(x, y, elements, material = {}, mergeRadius = material.mergeRadius ?? 0) {
  if (!elements.length) return Infinity;
  const shapes = elements.map((element) => toShape(element, material));
  const squircle = material.squircle ?? 2;

  let nearest = Infinity;
  const distances = shapes.map((shape) => {
    const d = sdPrimitive(x - shape.cx, y - shape.cy, shape.halfX, shape.halfY,
                          shape.type, shape.radius, squircle);
    if (d < nearest) nearest = d;
    return d;
  });

  if (!(mergeRadius >= 0.01) || shapes.length === 1) return nearest;

  const scale = Math.max(mergeRadius * MERGE_SCALE_RATIO, 0.01);
  let sum = 0;
  for (const d of distances) sum += Math.exp(-(d - nearest) / scale);
  return nearest - scale * Math.log(Math.max(sum, 1e-6));
}

/**
 * The element whose own primitive is nearest to the point, or `null` when the
 * point is outside the fused surface. `tolerance` grows the hit area, which is
 * what a coarse pointer (touch) wants.
 */
function hitTestElements(x, y, elements, material = {}, options = {}) {
  const mergeRadius = options.fusion === false
    ? 0
    : (options.mergeRadius ?? material.mergeRadius ?? 0);
  const tolerance = options.tolerance ?? 0;
  const squircle = material.squircle ?? 2;

  // Separate elements are separate draw calls. The last one painted owns every
  // overlapping pixel, regardless of how deeply the point lies inside an older
  // element. Picking the most-negative distance here would make a large card
  // steal clicks from a smaller button drawn on top of it.
  if (options.fusion === false) {
    for (let i = elements.length - 1; i >= 0; i--) {
      const shape = toShape(elements[i], material);
      const d = sdPrimitive(x - shape.cx, y - shape.cy, shape.halfX, shape.halfY,
                            shape.type, shape.radius, squircle);
      if (d <= tolerance) return elements[i];
    }
    return null;
  }

  // Mirror the renderer's connected-component splitting and 16-shape chunks.
  // In particular, do not invent a smooth-union bridge across a chunk boundary
  // that the GPU cannot draw. Iterate backwards because later passes composite
  // over earlier ones when separately rendered groups overlap.
  const groups = groupElements(elements, mergeRadius, MAX_GLASS_SHAPES).groups;
  for (let groupIndex = groups.length - 1; groupIndex >= 0; groupIndex--) {
    const group = groups[groupIndex];
    if (sdGroup(x, y, group, material, mergeRadius) > tolerance) continue;

    let best = null;
    let bestDistance = Infinity;
    for (let i = group.length - 1; i >= 0; i--) {
      const shape = toShape(group[i], material);
      const d = sdPrimitive(x - shape.cx, y - shape.cy, shape.halfX, shape.halfY,
                            shape.type, shape.radius, squircle);
      if (d < bestDistance) {
        bestDistance = d;
        best = group[i];
      }
    }
    return best;
  }
  return null;
}

/** Signed distance to the exact silhouette produced by the renderer's passes. */
function sdRenderedGroups(
  x, y, elements, material = {}, mergeRadius = material.mergeRadius ?? 0,
) {
  const groups = groupElements(elements, mergeRadius, MAX_GLASS_SHAPES).groups;
  if (!groups.length) return Infinity;
  let bestDistance = Infinity;
  for (const group of groups) {
    const d = sdGroup(x, y, group, material, mergeRadius);
    if (d < bestDistance) bestDistance = d;
  }
  return bestDistance;
}

/** Axis-aligned gap between two element boxes; 0 when they overlap. */
function boxGap(a, b) {
  const box = (element) => {
    const w = Number(element.w ?? element.width ?? element.size ?? 0);
    const h = Number(element.h ?? element.height ?? element.size ?? w);
    return { x: Number(element.x ?? 0), y: Number(element.y ?? 0), w, h };
  };
  const aa = box(a);
  const bb = box(b);
  const dx = Math.max(0, Math.max(aa.x - (bb.x + bb.w), bb.x - (aa.x + aa.w)));
  const dy = Math.max(0, Math.max(aa.y - (bb.y + bb.h), bb.y - (aa.y + aa.h)));
  return Math.hypot(dx, dy);
}

/**
 * Split elements into sets that can be shaded independently.
 *
 * Two elements land in the same set when their boxes are close enough for the
 * smooth-min to bridge them. Elements further apart than the influence radius
 * contribute nothing measurable to each other's distance field, so drawing
 * them in separate passes is visually identical to one fused pass.
 */
function connectedElementGroups(elements, mergeRadius = 0) {
  if (elements.length <= 1) return elements.length ? [elements.slice()] : [];
  const reach = Math.max(0, mergeRadius) * MERGE_SCALE_RATIO * MERGE_INFLUENCE_SCALES;

  const parent = elements.map((_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  for (let i = 0; i < elements.length; i++) {
    for (let j = i + 1; j < elements.length; j++) {
      if (boxGap(elements[i], elements[j]) <= reach) parent[find(i)] = find(j);
    }
  }

  const byRoot = new Map();
  elements.forEach((element, i) => {
    const root = find(i);
    if (!byRoot.has(root)) byRoot.set(root, []);
    byRoot.get(root).push(element);
  });

  return [...byRoot.values()];
}

/**
 * Connected sets, further chunked so no group exceeds the shader's uniform
 * arrays. A chunked set is the only lossy case: shapes that really do influence
 * each other end up in different passes, so callers should surface a warning
 * when `groupElements` reports it.
 */
function groupElements(elements, mergeRadius = 0, maxPerGroup = MAX_GLASS_SHAPES) {
  const connected = connectedElementGroups(elements, mergeRadius);
  const groups = [];
  let truncated = false;
  for (const group of connected) {
    if (group.length > maxPerGroup) truncated = true;
    for (let i = 0; i < group.length; i += maxPerGroup) {
      groups.push(group.slice(i, i + maxPerGroup));
    }
  }
  return { groups, truncated };
}


// ===== v2-geometry.js =====
// CPU mirror of the V2 transparent shader's geometry. V2 keeps its independent
// optical material and non-fusing passes, but uses the same three visual
// primitives as V1: folder/rect, capsule and circle.

const SHAPE_TYPES_V2 = Object.freeze({ rect: 0, folder: 0, pill: 1, circle: 2 });

function shapeTypeOfV2(shape) {
  return SHAPE_TYPES_V2[shape] ?? 0;
}

function sdRoundBoxV2(px, py, halfX, halfY, radius) {
  const r = Math.min(radius, halfX, halfY);
  const qx = Math.abs(px) - halfX + r;
  const qy = Math.abs(py) - halfY + r;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
}

function smoothUnionV2(d1, d2, radius) {
  if (!(radius > 0)) return Math.min(d1, d2);
  const h = Math.max(0, Math.min(1, 0.5 + 0.5 * (d2 - d1) / radius));
  return d2 * (1 - h) + d1 * h - radius * h * (1 - h);
}

function cornerRadiusV2(element, roundness = 0.47) {
  const width = Number(element.w ?? element.width ?? element.size ?? 0);
  const height = Number(element.h ?? element.height ?? element.size ?? width);
  // A caller may provide a CSS-pixel radius for surfaces that must register
  // to an external frame (for example the iPhone screen mask).  Keep the V2
  // material ratio as the default for authored components, but honour an
  // explicit radius when exact geometry matters.
  if (Number.isFinite(element.radius)) {
    return Math.max(0, Math.min(Number(element.radius), Math.min(width, height) * 0.5));
  }
  return Math.min(width, height) * 0.5 * roundness;
}

function sdElementV2(x, y, element, material = {}) {
  const width = Number(element.w ?? element.width ?? element.size ?? 0);
  const height = Number(element.h ?? element.height ?? element.size ?? width);
  const halfX = width / 2;
  const halfY = height / 2;
  const px = x - Number(element.x ?? 0) - halfX;
  const py = y - Number(element.y ?? 0) - halfY;
  const kind = shapeTypeOfV2(element.shape);
  const radius = cornerRadiusV2({ ...element, w: width, h: height }, material.roundness ?? 0.47);

  if (kind === 1) return sdRoundBoxV2(px, py, halfX, halfY, Math.min(halfX, halfY));
  if (kind === 2) return Math.hypot(px, py) - Math.min(halfX, halfY);
  return sdRoundBoxV2(px, py, halfX, halfY, radius);
}

function distanceToElementsV2(x, y, elements, material = {}) {
  let nearest = Infinity;
  for (const element of elements) nearest = Math.min(nearest, sdElementV2(x, y, element, material));
  return nearest;
}

function hitTestElementsV2(x, y, elements, material = {}, options = {}) {
  const tolerance = options.tolerance ?? 0;
  // The V2 shader resolves overlap by taking the last matching surface.
  for (let i = elements.length - 1; i >= 0; i--) {
    if (sdElementV2(x, y, elements[i], material) <= tolerance) return elements[i];
  }
  return null;
}


// ===== v2-material.js =====
// V2 is the clear optical material from the transparent renderer. These
// values deliberately live outside material.js: similarly named V1 controls
// (notably dispersion and edgeWidth) use different units and shader maths.
const DEFAULT_MATERIAL_V2 = Object.freeze({
  refraction: 90,
  edgeReach: 0,
  edgeWidth: 0,
  dispersion: 2.0,
  // Dimensionless softness ratio. The shader multiplies this by each
  // component's short side, so the same value stays delicate on small icons
  // and becomes denser on larger cards.
  frost: 0.18,
  body: 0.72,
  absorption: 0.58,
  tint: 0,
  rim: 0.72,
  reflection: 0.68,
  highlight: 0.38,
  lightAngle: 136,
  echo: 0.28,
  hairline: 0.92,
  hairWidth: 0.52,
  roundness: 0.47,
});

const REDUCED_TRANSPARENCY_MATERIAL_V2 = Object.freeze({
  refraction: 0,
  edgeReach: 0,
  dispersion: 0,
  frost: 0,
  body: 1.5,
  tint: 1.35,
  reflection: 0.18,
  highlight: 0.12,
  echo: 0,
});

const SLIDERS_V2 = Object.freeze([
  ['refraction', 0, 110, 1],
  ['edgeReach', 0, 160, 1],
  ['edgeWidth', 0, 0.55, 0.01],
  ['dispersion', 0, 7, 0.1],
  ['frost', 0, 1, 0.01],
  ['body', 0, 1.5, 0.01],
  ['absorption', 0, 2, 0.01],
  ['tint', 0, 1.5, 0.01],
  ['rim', 0, 1, 0.01],
  ['reflection', 0, 1.5, 0.01],
  ['highlight', 0, 1.5, 0.01],
  ['lightAngle', -180, 180, 1],
  ['echo', 0, 1.5, 0.01],
  ['hairline', 0, 1.5, 0.01],
  ['hairWidth', 0, 1, 0.01],
  ['roundness', 0.05, 0.6, 0.01],
]);

/** Return a fresh V2 material. No V1 preset or parameter conversion is used. */
function getDefaultMaterialV2() {
  return { ...DEFAULT_MATERIAL_V2 };
}

function makeMaterialV2(overrides = {}) {
  if (typeof overrides === 'string') {
    throw new TypeError('Liquid Glass V2 does not use V1 preset names.');
  }
  const unknown = Object.keys(overrides || {}).filter((key) => !(key in DEFAULT_MATERIAL_V2));
  if (unknown.length) {
    throw new TypeError(`Unknown Liquid Glass V2 material parameter${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}`);
  }
  return { ...getDefaultMaterialV2(), ...(overrides || {}) };
}


// ===== renderer.js =====




function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(log + '\n' + src);
  }
  return s;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  const vertex = compile(gl, gl.VERTEX_SHADER, vs);
  let fragment;
  try {
    fragment = compile(gl, gl.FRAGMENT_SHADER, fs);
  } catch (error) {
    gl.deleteShader(vertex);
    gl.deleteProgram(p);
    throw error;
  }
  gl.attachShader(p, vertex);
  gl.attachShader(p, fragment);
  gl.linkProgram(p);
  // The shader objects only exist to build the program; keeping them alive
  // holds on to driver memory for the lifetime of the renderer.
  gl.detachShader(p, vertex);
  gl.detachShader(p, fragment);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error(log);
  }
  const loc = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const name = gl.getActiveUniform(p, i).name.replace('[0]', '');
    loc[name] = gl.getUniformLocation(p, name);
  }
  return { p, loc };
}

const MIPS = 7;

class GlassRenderer {
  constructor(canvas, options = {}) {
    const gl = canvas.getContext('webgl2', {
      alpha: Boolean(options.alpha), antialias: false, premultipliedAlpha: true,
      // Reading the canvas back (screenshots, toDataURL) needs the drawing
      // buffer preserved, but it also stops the driver from discarding it
      // between frames. Off by default; the tooling turns it on explicitly.
      preserveDrawingBuffer: Boolean(options.preserveDrawingBuffer),
    });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    this.canvas = canvas;
    this.materialVersion = options.materialVersion === 2 ? 2 : 1;
    // Set while the GPU context is gone. Every GL call in this class is a no-op
    // until `restore()` rebuilds the resources, so a lost context degrades to a
    // frozen surface instead of an exception storm.
    this.lost = false;

    this.tex = null;
    this.blurTex = null;
    this.wallpapers = [];
    this.fbos = [];
    this.blurFbos = [];
    this.mipLevels = 0;
    this.w = 0;
    this.h = 0;
    this.createResources();
  }

  createResources() {
    const gl = this.gl;
    this.quad = gl.createVertexArray();
    gl.bindVertexArray(this.quad);
    this.quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.progWall = program(gl, VS_FULLSCREEN, FS_WALLPAPER);
    this.progDown = program(gl, VS_FULLSCREEN, FS_DOWN);
    this.progUp = program(gl, VS_FULLSCREEN, FS_UP);
    this.progBlit = program(gl, VS_FULLSCREEN, FS_BLIT);
    this.progGlass = program(gl, VS_GLASS,
      this.materialVersion === 2 ? FS_GLASS_V2 : FS_GLASS);

    // FS_WALLPAPER always has a sampler, even for its procedural path. Binding
    // the backdrop mip texture while rendering into that same texture is an
    // illegal feedback loop, so keep a complete inert texture for uUseImage=0.
    this.fallbackTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.fallbackTexture);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 255]),
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  releaseResources() {
    const gl = this.gl;
    for (const entry of [
      this.progWall, this.progDown, this.progUp, this.progBlit, this.progGlass,
    ]) {
      if (entry) gl.deleteProgram(entry.p);
    }
    this.progWall = null;
    this.progDown = null;
    this.progUp = null;
    this.progBlit = null;
    this.progGlass = null;
    if (this.quad) gl.deleteVertexArray(this.quad);
    if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer);
    if (this.fallbackTexture) gl.deleteTexture(this.fallbackTexture);
    this.quad = null;
    this.quadBuffer = null;
    this.fallbackTexture = null;
  }

  releaseTargets() {
    const gl = this.gl;
    if (this.tex) gl.deleteTexture(this.tex);
    if (this.blurTex) gl.deleteTexture(this.blurTex);
    this.fbos.forEach((framebuffer) => gl.deleteFramebuffer(framebuffer));
    this.blurFbos.forEach((framebuffer) => gl.deleteFramebuffer(framebuffer));
    this.tex = null;
    this.blurTex = null;
    this.fbos = [];
    this.blurFbos = [];
    this.mipLevels = 0;
  }

  // Drops every handle without touching the GPU: after a context loss the ids
  // are already invalid and deleting them is meaningless.
  handleContextLost() {
    this.lost = true;
    this.progWall = null;
    this.progDown = null;
    this.progUp = null;
    this.progBlit = null;
    this.progGlass = null;
    this.quad = null;
    this.quadBuffer = null;
    this.fallbackTexture = null;
    this.tex = null;
    this.blurTex = null;
    this.fbos = [];
    this.blurFbos = [];
    for (const entry of this.wallpapers) {
      entry.texture = null;
      entry.ready = false;
      entry.width = 0;
      entry.height = 0;
    }
  }

  // Rebuilds programs, render targets and backdrop textures after the browser
  // restores the context. The WebGL2 context object itself is reused per spec,
  // so only the resources have to be recreated.
  restore() {
    if (!this.lost) return this;
    this.lost = false;
    this.createResources();
    const { w, h } = this;
    this.w = 0;
    this.h = 0;
    if (w > 0 && h > 0) this.resize(w, h);
    this.createWallpaperTextures();
    return this;
  }

  hasLiveBackdrop() {
    return this.wallpapers.some((entry) => entry.update === 'live');
  }

  sourceSize(source) {
    return [
      Number(source?.videoWidth || source?.naturalWidth || source?.width || 0),
      Number(source?.videoHeight || source?.naturalHeight || source?.height || 0),
    ];
  }

  uploadWallpaper(entry, forceAllocation = false) {
    if (this.lost || !entry.texture) return false;
    const [width, height] = this.sourceSize(entry.source);
    if (!(width > 0) || !(height > 0)) return false;

    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, entry.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    if (!forceAllocation && entry.ready && entry.width === width && entry.height === height) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, entry.source);
    } else {
      gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, entry.source,
      );
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    entry.width = width;
    entry.height = height;
    entry.ready = true;
    return true;
  }

  resize(w, h) {
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    if (this.lost) { this.w = w; this.h = h; return; }
    if (w === this.w && h === this.h) return;
    const gl = this.gl;
    this.w = w; this.h = h;
    this.canvas.width = w; this.canvas.height = h;

    this.releaseTargets();

    // texStorage2D rejects a level count larger than the size can represent.
    // Seven levels are useful on a full-screen surface, but a 32px icon only
    // has six (32, 16, 8, 4, 2, 1).
    this.mipLevels = Math.min(MIPS, Math.floor(Math.log2(Math.max(w, h))) + 1);

    const createMipTexture = () => {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      // Sampling an sRGB texture decodes RGB to linear; writing to the sRGB
      // attachment encodes it again. Alpha remains linear, preserving the
      // optical-density side channel.
      gl.texStorage2D(gl.TEXTURE_2D, this.mipLevels, gl.SRGB8_ALPHA8, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return texture;
    };

    this.tex = createMipTexture();
    this.blurTex = createMipTexture();
    this.fbos = [];
    this.blurFbos = [];
    for (let i = 0; i < this.mipLevels; i++) {
      const f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, i);
      this.fbos.push(f);

      const blurFbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, blurFbo);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.blurTex, i,
      );
      this.blurFbos.push(blurFbo);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // (Re)allocates a GL texture per backdrop entry and uploads its first frame.
  createWallpaperTextures() {
    if (this.lost) return;
    const gl = this.gl;
    for (const entry of this.wallpapers) {
      if (entry.texture) gl.deleteTexture(entry.texture);
      entry.texture = gl.createTexture();
      entry.ready = false;
      entry.width = 0;
      entry.height = 0;
      gl.bindTexture(gl.TEXTURE_2D, entry.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.uploadWallpaper(entry, true);
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  setWallpapers(images, options = {}) {
    const gl = this.gl;
    const update = options.update === 'live' ? 'live' : 'static';
    if (!this.lost) this.wallpapers.forEach((entry) => gl.deleteTexture(entry.texture));
    this.wallpapers = images.map((source) => ({
      texture: null,
      source,
      update,
      ready: false,
      width: 0,
      height: 0,
    }));
    this.createWallpaperTextures();
  }

  refreshWallpapers(force = false) {
    if (this.lost) return;
    for (const entry of this.wallpapers) {
      if (force || entry.update === 'live') this.uploadWallpaper(entry);
    }
    this.gl.bindTexture(this.gl.TEXTURE_2D, null);
  }

  mipSize(level) {
    return [Math.max(1, this.w >> level), Math.max(1, this.h >> level)];
  }

  // Renders the backdrop into mip 0 and builds the progressively blurred chain.
  buildBackdrop(scene, zoom = 1) {
    if (this.lost || !this.fbos.length) return;
    const gl = this.gl;
    this.refreshWallpapers();
    gl.bindVertexArray(this.quad);
    gl.disable(gl.BLEND);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos[0]);
    gl.viewport(0, 0, this.w, this.h);
    gl.useProgram(this.progWall.p);
    gl.uniform2f(this.progWall.loc.uRes, this.w, this.h);
    gl.uniform1i(this.progWall.loc.uScene, scene);
    gl.uniform1f(this.progWall.loc.uZoom, zoom);
    const wallpaper = this.wallpapers[scene];
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, wallpaper?.ready ? wallpaper.texture : this.fallbackTexture);
    gl.uniform1i(this.progWall.loc.uWallpaper, 1);
    gl.uniform1i(this.progWall.loc.uUseImage, wallpaper?.ready ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.useProgram(this.progDown.p);
    gl.uniform1i(this.progDown.loc.uTex, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    for (let i = 1; i < this.mipLevels; i++) {
      const [sw, sh] = this.mipSize(i - 1);
      const [dw, dh] = this.mipSize(i);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, i - 1);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, i - 1);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos[i]);
      gl.viewport(0, 0, dw, dh);
      gl.uniform2f(this.progDown.loc.uTexel, 1 / sw, 1 / sh);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, 0);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, this.mipLevels - 1);

    // Seed the coarsest reconstructed level, then walk back toward full
    // resolution with a tent filter. Restricting BASE/MAX_LEVEL keeps sampling
    // a different mip image from the one attached for drawing, avoiding a
    // framebuffer feedback loop while retaining one filterable texture chain.
    const last = this.mipLevels - 1;
    const [lastW, lastH] = this.mipSize(last);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.fbos[last]);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.blurFbos[last]);
    gl.blitFramebuffer(
      0, 0, lastW, lastH, 0, 0, lastW, lastH, gl.COLOR_BUFFER_BIT, gl.NEAREST,
    );

    gl.bindVertexArray(this.quad);
    gl.useProgram(this.progUp.p);
    gl.uniform1i(this.progUp.loc.uLow, 0);
    gl.uniform1i(this.progUp.loc.uHigh, 1);
    for (let i = last - 1; i >= 0; i--) {
      const [lowW, lowH] = this.mipSize(i + 1);
      const [dw, dh] = this.mipSize(i);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.blurTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, i + 1);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, i + 1);

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, i);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, i);

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurFbos[i]);
      gl.viewport(0, 0, dw, dh);
      gl.uniform2f(this.progUp.loc.uLowTexel, 1 / lowW, 1 / lowH);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.blurTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, 0);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, this.mipLevels - 1);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, 0);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, this.mipLevels - 1);
  }

  // Draws the sharp backdrop to the screen.
  drawBackdrop() {
    if (this.lost || !this.tex) return;
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.w, this.h);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.quad);
    gl.useProgram(this.progBlit.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(this.progBlit.loc.uTex, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // Clears the visible framebuffer while preserving the offscreen backdrop
  // texture. Used when the canvas overlays an existing DOM/canvas backdrop.
  clearOutput() {
    if (this.lost) return;
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.w, this.h);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  // elements: {x, y, w, h, shape} in CSS pixels, y measured from the TOP.
  // The group is evaluated as a single smooth-union SDF. This is important:
  // compositing independent glass draws can overlap, but can never produce the
  // shared silhouette and continuous normals of one fused liquid surface.
  drawGlassGroup(elements, m, dpr, mergeRadius = m.mergeRadius ?? 0) {
    if (!elements.length || this.lost || !this.tex) return;

    const gl = this.gl;
    const { loc, p } = this.progGlass;
    const shapes = elements.slice(0, MAX_GLASS_SHAPES);

    const minX = Math.min(...shapes.map((element) => element.x));
    const minY = Math.min(...shapes.map((element) => element.y));
    const maxX = Math.max(...shapes.map((element) => element.x + element.w));
    const maxY = Math.max(...shapes.map((element) => element.y + element.h));
    const groupWidth = maxX - minX;
    const groupHeight = maxY - minY;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.w, this.h);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.quad);
    gl.useProgram(p);

    const cx = (minX + groupWidth / 2) * dpr;
    const cy = this.h - (minY + groupHeight / 2) * dpr;
    const hw = (groupWidth / 2) * dpr;
    const hh = (groupHeight / 2) * dpr;
    const centers = new Float32Array(MAX_GLASS_SHAPES * 2);
    const halves = new Float32Array(MAX_GLASS_SHAPES * 2);
    const radii = new Float32Array(MAX_GLASS_SHAPES);
    const types = new Int32Array(MAX_GLASS_SHAPES);

    shapes.forEach((element, i) => {
      const short = Math.min(element.w, element.h);
      centers[i * 2] = (element.x + element.w / 2) * dpr;
      centers[i * 2 + 1] = this.h - (element.y + element.h / 2) * dpr;
      halves[i * 2] = element.w / 2 * dpr;
      halves[i * 2 + 1] = element.h / 2 * dpr;
      radii[i] = Math.min(element.radius ?? m.radius, short * 0.235) * dpr;
      types[i] = element.shape === 'pill' ? 1 : element.shape === 'circle' ? 2 : 0;
    });

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(loc.uSrc, 0);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.blurTex);
    gl.uniform1i(loc.uBlurSrc, 2);
    gl.uniform2f(loc.uRes, this.w, this.h);
    gl.uniform2f(loc.uCenter, cx, cy);
    gl.uniform2f(loc.uHalf, hw, hh);
    gl.uniform1i(loc.uShapeCount, shapes.length);
    gl.uniform2fv(loc.uShapeCenters, centers);
    gl.uniform2fv(loc.uShapeHalves, halves);
    gl.uniform1iv(loc.uShapeTypes, types);
    gl.uniform1fv(loc.uShapeRadii, radii);
    gl.uniform1f(loc.uMergeRadius, Math.max(0, mergeRadius) * dpr);
    gl.uniform1f(loc.uPad, (m.shadowSize * 4 + Math.max(mergeRadius, 0) * 0.3 + 8) * dpr);
    gl.uniform1f(loc.uSquircle, m.squircle);
    gl.uniform1f(loc.uBevel, m.bevel * dpr);
    gl.uniform1f(loc.uHeight, m.height * dpr);
    gl.uniform1f(loc.uSizeAdaptation, m.sizeAdaptation ?? 1);
    gl.uniform1f(loc.uIOR, m.ior);
    gl.uniform1f(loc.uDispersion, m.dispersion);
    gl.uniform1f(loc.uBlurPlateau, m.blurPlateau * dpr);
    gl.uniform1f(loc.uBlurRim, m.blurRim * dpr);
    gl.uniform1f(loc.uOpticalDensity, m.opticalDensity);
    gl.uniform1f(loc.uMips, this.mipLevels);
    gl.uniform1f(loc.uSpecular, m.specular);
    gl.uniform1f(loc.uSpecPower, m.specPower);
    gl.uniform1f(loc.uHighlightAdapt, m.highlightAdapt);
    gl.uniform1f(loc.uHighlightWidth, m.highlightWidth);
    gl.uniform1f(loc.uHighlightSharpness, m.highlightSharpness);
    gl.uniform1f(loc.uHighlightBase, m.highlightBase);
    gl.uniform1f(loc.uFresnel, m.fresnel);
    gl.uniform1f(loc.uSat, m.saturation);
    gl.uniform1f(loc.uBright, m.brightness);
    gl.uniform1f(loc.uTintAmount, m.tintAmount);
    gl.uniform3f(loc.uTintColor, ...m.tintColor);
    gl.uniform1f(loc.uTintAdapt, m.tintAdapt ?? 0);
    gl.uniform1f(loc.uShadow, m.shadow);
    gl.uniform1f(loc.uShadowSize, m.shadowSize * dpr);
    gl.uniform1f(loc.uShadowOffset, m.shadowOffset * dpr);
    gl.uniform2f(loc.uLightDir, m.lightX, m.lightY);
    gl.uniform1f(loc.uEdgeLine, m.edgeLine);
    gl.uniform1f(loc.uEdgeWidth, m.edgeWidth * dpr);
    gl.uniform1f(loc.uEdgeDark, m.edgeDark);
    gl.uniform1f(loc.uRefractScale, m.refractScale);
    gl.uniform1f(loc.uMeniscus, m.meniscus);
    gl.uniform1i(loc.uDebug, m.debug | 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disable(gl.BLEND);
  }

  drawGlass(element, m, dpr) {
    this.drawGlassGroup([element], m, dpr, 0);
  }

  // V2 surfaces share V1's public silhouettes and backdrop/mip pipeline, but
  // nothing from the material calculation. In particular, similarly named
  // uniforms are filled using V2's own units: edgeWidth is a fraction,
  // dispersion is a pixel split, and roundness is a short-half ratio.
  drawGlassV2Group(elements, m, dpr, lightDirections = [], tintLights = []) {
    if (!elements.length || this.lost || !this.tex) return;

    const gl = this.gl;
    const { loc, p } = this.progGlass;
    const shapes = elements.slice(0, MAX_GLASS_SHAPES);
    const minX = Math.min(...shapes.map((element) => element.x));
    const minY = Math.min(...shapes.map((element) => element.y));
    const maxX = Math.max(...shapes.map((element) => element.x + element.w));
    const maxY = Math.max(...shapes.map((element) => element.y + element.h));
    const groupWidth = maxX - minX;
    const groupHeight = maxY - minY;

    const centers = new Float32Array(MAX_GLASS_SHAPES * 2);
    const halves = new Float32Array(MAX_GLASS_SHAPES * 2);
    const radii = new Float32Array(MAX_GLASS_SHAPES);
    const types = new Int32Array(MAX_GLASS_SHAPES);
    const lights = new Float32Array(MAX_GLASS_SHAPES * 2);
    const tints = new Float32Array(MAX_GLASS_SHAPES);
    const tintTones = new Float32Array(MAX_GLASS_SHAPES);
    const frosts = new Float32Array(MAX_GLASS_SHAPES);
    const opacities = new Float32Array(MAX_GLASS_SHAPES);
    shapes.forEach((element, i) => {
      const short = Math.min(element.w, element.h);
      centers[i * 2] = (element.x + element.w / 2) * dpr;
      centers[i * 2 + 1] = this.h - (element.y + element.h / 2) * dpr;
      halves[i * 2] = element.w / 2 * dpr;
      halves[i * 2 + 1] = element.h / 2 * dpr;
      // V2 normally derives the corner from its dimensionless roundness
      // ratio. An explicit element radius keeps surfaces such as a phone
      // screen exactly aligned with their external clip path.
      radii[i] = Math.min(
        element.radius ?? short * 0.5 * m.roundness,
        short * 0.5,
      ) * dpr;
      types[i] = element.shape === 'pill' ? 1
        : element.shape === 'circle' ? 2 : 0;
      const direction = lightDirections[i] ?? [Math.SQRT1_2, Math.SQRT1_2];
      lights[i * 2] = direction[0];
      lights[i * 2 + 1] = direction[1];
      tints[i] = element.tint ?? m.tint;
      tintTones[i] = tintLights[i] ?? 1;
      // V2 frost is a dimensionless ratio resolved in the shader against the
      // component short side. V1 keeps its authored CSS-pixel blur lengths.
      frosts[i] = element.frost ?? m.frost;
      opacities[i] = element.opacity ?? 1;
    });

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.w, this.h);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.quad);
    gl.useProgram(p);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(loc.uSrc, 0);
    gl.uniform2f(loc.uRes, this.w, this.h);
    gl.uniform1f(loc.uDpr, dpr);
    gl.uniform2f(loc.uCenter,
      (minX + groupWidth / 2) * dpr,
      this.h - (minY + groupHeight / 2) * dpr);
    gl.uniform2f(loc.uHalf, groupWidth / 2 * dpr, groupHeight / 2 * dpr);
    gl.uniform1f(loc.uPad, 4 * dpr);
    gl.uniform1f(loc.uMips, this.mipLevels);
    gl.uniform1i(loc.uShapeCount, shapes.length);
    gl.uniform2fv(loc.uShapeCenters, centers);
    gl.uniform2fv(loc.uShapeHalves, halves);
    gl.uniform1iv(loc.uShapeTypes, types);
    gl.uniform1fv(loc.uShapeRadii, radii);
    gl.uniform1fv(loc.uShapeTints, tints);
    gl.uniform1fv(loc.uShapeTintLights, tintTones);
    gl.uniform1fv(loc.uShapeFrosts, frosts);
    gl.uniform1fv(loc.uShapeOpacities, opacities);
    gl.uniform2fv(loc.uLightDirs, lights);
    gl.uniform1f(loc.uRefraction, m.refraction * dpr);
    gl.uniform1f(loc.uEdgeReach, m.edgeReach * dpr);
    gl.uniform1f(loc.uEdgeWidth, m.edgeWidth);
    gl.uniform1f(loc.uDispersion, m.dispersion);
    gl.uniform1f(loc.uBody, m.body);
    gl.uniform1f(loc.uAbsorption, m.absorption);
    gl.uniform1f(loc.uRim, m.rim);
    gl.uniform1f(loc.uReflection, m.reflection);
    gl.uniform1f(loc.uHighlight, m.highlight);
    gl.uniform1f(loc.uEcho, m.echo);
    gl.uniform1f(loc.uHairline, m.hairline);
    gl.uniform1f(loc.uHairWidth, m.hairWidth);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disable(gl.BLEND);
  }

  destroy() {
    if (this.lost) {
      this.wallpapers = [];
      return;
    }
    const gl = this.gl;
    this.releaseTargets();
    this.releaseResources();
    this.wallpapers.forEach((entry) => gl.deleteTexture(entry.texture));
    this.wallpapers = [];
  }
}


// ===== v2.js =====





const SHAPES_V2 = new Set(['folder', 'rect', 'pill', 'circle']);
const COMPOSITE_MODES = new Set(['replace', 'overlay']);
const BACKDROP_UPDATES = new Set(['auto', 'static', 'live']);
const REDUCED_TRANSPARENCY_QUERY = '(prefers-reduced-transparency: reduce)';

function normalizeCompositeMode(mode) {
  if (!COMPOSITE_MODES.has(mode)) throw new TypeError(`Unknown liquid glass V2 composite mode: ${mode}`);
  return mode;
}

function normalizeShape(shape) {
  const normalized = shape === 'folderRect' ? 'rect' : shape;
  if (!SHAPES_V2.has(normalized)) throw new TypeError(`Unknown liquid glass V2 shape: ${shape}`);
  return normalized;
}

function normalizeElement(input, index) {
  const width = Number(input.w ?? input.width ?? input.size ?? 0);
  const height = Number(input.h ?? input.height ?? input.size ?? width);
  if (!(width > 0) || !(height > 0)) {
    throw new TypeError('Liquid glass V2 elements need a positive width and height.');
  }
  const tint = input.tint == null ? undefined : Number(input.tint);
  if (tint !== undefined && !Number.isFinite(tint)) {
    throw new TypeError('Liquid glass V2 element tint must be a finite number.');
  }
  const frost = input.frost == null ? undefined : Number(input.frost);
  if (frost !== undefined && !Number.isFinite(frost)) {
    throw new TypeError('Liquid glass V2 element frost must be a finite number.');
  }
  const opacity = input.opacity == null ? undefined : Number(input.opacity);
  if (opacity !== undefined && !Number.isFinite(opacity)) {
    throw new TypeError('Liquid glass V2 element opacity must be a finite number.');
  }
  const tintTone = input.tintTone ?? 'auto';
  if (!['auto', 'light', 'dark'].includes(tintTone)) {
    throw new TypeError(`Unknown liquid glass V2 tint tone: ${tintTone}`);
  }
  return {
    ...input,
    id: input.id ?? `glass-v2-${index + 1}`,
    shape: normalizeShape(input.shape ?? 'rect'),
    x: Number(input.x ?? 0),
    y: Number(input.y ?? 0),
    w: width,
    h: height,
    ...(tint === undefined ? {} : { tint }),
    ...(frost === undefined ? {} : { frost }),
    ...(opacity === undefined ? {} : { opacity }),
    ...(input.tintTone == null ? {} : { tintTone }),
  };
}

function resolveImage(source) {
  if (typeof source !== 'string') return Promise.resolve(source);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load liquid glass V2 wallpaper: ${source}`));
    image.src = source;
  });
}

function isLiveBackdropSource(source) {
  const tagName = source?.tagName?.toUpperCase();
  return tagName === 'CANVAS' || tagName === 'VIDEO'
    || source?.constructor?.name === 'OffscreenCanvas'
    || source?.constructor?.name === 'VideoFrame';
}

function resolveBackdropUpdate(source, update = 'auto') {
  if (!BACKDROP_UPDATES.has(update)) {
    throw new TypeError(`Unknown liquid glass V2 backdrop update mode: ${update}`);
  }
  return update === 'auto' ? (isLiveBackdropSource(source) ? 'live' : 'static') : update;
}

function matchMediaSafe(query) {
  return typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia(query) : null;
}

/**
 * Clear optical Liquid Glass V2.
 *
 * This is a separate public class, not a mode on LiquidGlassWebGL. Its material
 * values are never converted from V1. It intentionally shares V1's public
 * shape silhouettes while refraction, chromatic split, tint and interface
 * lighting continue to follow the independent V2 equations.
 */
class LiquidGlassWebGLV2 {
  static isSupported() {
    if (typeof document === 'undefined') return false;
    try {
      const probe = document.createElement('canvas');
      const gl = probe.getContext('webgl2');
      if (!gl) return false;
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return true;
    } catch {
      return false;
    }
  }

  constructor(canvas, options = {}) {
    if (!canvas || typeof canvas.getContext !== 'function') {
      throw new TypeError('LiquidGlassWebGLV2 needs an HTMLCanvasElement.');
    }
    this.canvas = canvas;
    this.version = 'v2';
    this.compositeMode = normalizeCompositeMode(options.compositeMode ?? 'replace');
    this.renderer = new GlassRenderer(canvas, {
      alpha: this.compositeMode === 'overlay',
      preserveDrawingBuffer: Boolean(options.preserveDrawingBuffer),
      materialVersion: 2,
    });
    this.material = makeMaterialV2(options.material);
    this.elements = [];
    this.backdrops = [];
    this.wallpaperIndex = 0;
    this.wallpaperZoom = options.wallpaperZoom ?? 1;
    this.running = false;
    this.animationFrame = 0;
    this.dirty = true;
    this.backdropDirty = true;
    this.lightFieldDirty = true;
    this.lastFrame = { width: 0, height: 0, dpr: 0 };
    this.warnedShapeLimit = false;
    this.lightCanvas = null;
    this.lightPixels = null;
    this.lightSampleSize = 64;
    this.smoothedLightDirections = new Map();
    this.lastLightFieldUpdate = 0;
    this.lastLightBlendTime = 0;
    this.onContextLost = options.onContextLost ?? null;
    this.onContextRestored = options.onContextRestored ?? null;

    this.respectReducedTransparency = options.respectReducedTransparency ?? true;
    this.reducedTransparencyQuery = this.respectReducedTransparency
      ? matchMediaSafe(REDUCED_TRANSPARENCY_QUERY) : null;
    this.handleReducedTransparencyChange = () => {
      this.markDirty();
      this.render();
    };
    this.reducedTransparencyQuery?.addEventListener?.('change', this.handleReducedTransparencyChange);

    this.handleContextLost = (event) => {
      event.preventDefault();
      this.renderer.handleContextLost();
      this.markBackdropDirty();
      this.onContextLost?.(event);
    };
    this.handleContextRestored = (event) => {
      this.renderer.restore();
      this.markBackdropDirty();
      this.lastFrame = { width: 0, height: 0, dpr: 0 };
      this.onContextRestored?.(event);
      this.render();
    };
    canvas.addEventListener('webglcontextlost', this.handleContextLost, false);
    canvas.addEventListener('webglcontextrestored', this.handleContextRestored, false);

    this.resizeObserver = null;
    if ((options.autoResize ?? true) && typeof globalThis.ResizeObserver === 'function') {
      this.resizeObserver = new globalThis.ResizeObserver(() => {
        this.lightFieldDirty = true;
        this.markDirty();
        this.render();
      });
      this.resizeObserver.observe(canvas);
    }

    if (options.elements) this.setElements(options.elements, false);
    if (options.wallpapers) this.setWallpapers(options.wallpapers, false);
    if (options.backdrop) {
      this.setBackdrop(options.backdrop, {
        update: options.backdropUpdate,
        autoStart: options.autoStart,
        shouldRender: false,
      });
    }
  }

  get contextLost() { return this.renderer.lost; }
  get reducedTransparency() { return Boolean(this.reducedTransparencyQuery?.matches); }
  get effectiveMaterial() {
    return this.reducedTransparency
      ? { ...this.material, ...REDUCED_TRANSPARENCY_MATERIAL_V2 }
      : this.material;
  }

  markDirty() {
    this.dirty = true;
    return this;
  }

  markBackdropDirty() {
    this.backdropDirty = true;
    this.lightFieldDirty = true;
    this.lastLightFieldUpdate = 0;
    this.smoothedLightDirections.clear();
    return this.markDirty();
  }

  setElements(elements, shouldRender = true) {
    this.elements = elements.map((element, index) => normalizeElement(element, index));
    this.markDirty();
    if (shouldRender) this.render();
    return this;
  }

  addElement(element, shouldRender = true) {
    const normalized = normalizeElement(element, this.elements.length);
    this.elements.push(normalized);
    this.markDirty();
    if (shouldRender) this.render();
    return normalized.id;
  }

  updateElement(id, patch, shouldRender = true) {
    const index = this.elements.findIndex((element) => element.id === id);
    if (index === -1) return this;
    this.elements[index] = normalizeElement({ ...this.elements[index], ...patch }, index);
    this.markDirty();
    if (shouldRender) this.render();
    return this;
  }

  removeElement(id, shouldRender = true) {
    this.elements = this.elements.filter((element) => element.id !== id);
    this.markDirty();
    if (shouldRender) this.render();
    return this;
  }

  setMaterial(material, shouldRender = true) {
    if (typeof material === 'string') {
      throw new TypeError('Liquid Glass V2 does not convert V1 preset names. Pass a V2 material object.');
    }
    this.material = makeMaterialV2({ ...this.material, ...(material || {}) });
    this.markDirty();
    if (shouldRender) this.render();
    return this;
  }

  setWallpapers(images, shouldRender = true) {
    this.backdrops = images.slice();
    this.renderer.setWallpapers(images, { update: 'static' });
    this.markBackdropDirty();
    if (shouldRender) this.render();
    return this;
  }

  async loadWallpapers(sources, shouldRender = true) {
    const images = await Promise.all(sources.map(resolveImage));
    return this.setWallpapers(images, shouldRender);
  }

  async setWallpaper(source, shouldRender = true) {
    return this.loadWallpapers([source], shouldRender);
  }

  setBackdrop(source, options = {}) {
    if (!source || typeof source === 'string') {
      throw new TypeError('setBackdrop needs a CanvasImageSource. Use loadBackdrop for a URL.');
    }
    const update = resolveBackdropUpdate(source, options.update);
    this.backdrops = [source];
    this.renderer.setWallpapers([source], { update });
    this.wallpaperIndex = 0;
    this.markBackdropDirty();
    if (options.autoStart ?? update === 'live') this.start();
    if (options.shouldRender ?? true) this.render();
    return this;
  }

  async loadBackdrop(source, options = {}) {
    const image = await resolveImage(source);
    return this.setBackdrop(image, { ...options, update: options.update ?? 'static' });
  }

  updateBackdrop(shouldRender = true) {
    this.renderer.refreshWallpapers(true);
    this.markBackdropDirty();
    if (shouldRender) this.render();
    return this;
  }

  setWallpaperIndex(index, shouldRender = true) {
    this.wallpaperIndex = Math.max(0, Math.floor(index));
    this.markBackdropDirty();
    if (shouldRender) this.render();
    return this;
  }

  distanceAt(x, y) {
    return distanceToElementsV2(x, y, this.elements, this.material);
  }

  hitTest(x, y, options = {}) {
    return hitTestElementsV2(x, y, this.elements, this.material, options);
  }

  pointerPosition(event) {
    const rect = this.canvas.getBoundingClientRect();
    const source = event.touches?.[0] ?? event.changedTouches?.[0] ?? event;
    return { x: source.clientX - rect.left, y: source.clientY - rect.top };
  }

  hitTestEvent(event, options = {}) {
    const { x, y } = this.pointerPosition(event);
    const tolerance = options.tolerance
      ?? (event.pointerType && event.pointerType !== 'mouse' ? 8 : 0);
    return this.hitTest(x, y, { ...options, tolerance });
  }

  start() {
    if (this.running) return this;
    if (typeof globalThis.requestAnimationFrame !== 'function') {
      throw new Error('LiquidGlassWebGLV2.start() requires requestAnimationFrame.');
    }
    this.running = true;
    const tick = () => {
      if (!this.running) return;
      this.render();
      this.animationFrame = globalThis.requestAnimationFrame(tick);
    };
    this.animationFrame = globalThis.requestAnimationFrame(tick);
    return this;
  }

  stop() {
    this.running = false;
    if (this.animationFrame && typeof globalThis.cancelAnimationFrame === 'function') {
      globalThis.cancelAnimationFrame(this.animationFrame);
    }
    this.animationFrame = 0;
    return this;
  }

  resize(width = this.canvas.clientWidth || this.canvas.width || 1,
         height = this.canvas.clientHeight || this.canvas.height || 1,
         dpr = Math.min(globalThis.devicePixelRatio || 1, 2)) {
    this.renderer.resize(Math.round(width * dpr), Math.round(height * dpr));
    return { width, height, dpr };
  }

  updateLightField() {
    this.lightFieldDirty = false;
    const source = this.backdrops[this.wallpaperIndex];
    const sourceWidth = Number(source?.videoWidth || source?.naturalWidth || source?.width || 0);
    const sourceHeight = Number(source?.videoHeight || source?.naturalHeight || source?.height || 0);
    if (!(sourceWidth > 0) || !(sourceHeight > 0) || typeof document === 'undefined') {
      this.lightPixels = null;
      return;
    }
    if (!this.lightCanvas) this.lightCanvas = document.createElement('canvas');
    const size = this.lightSampleSize;
    this.lightCanvas.width = size;
    this.lightCanvas.height = size;
    const context = this.lightCanvas.getContext('2d', { willReadFrequently: true });
    if (!context) { this.lightPixels = null; return; }
    context.clearRect(0, 0, size, size);
    const scale = Math.max(size / sourceWidth, size / sourceHeight) * this.wallpaperZoom;
    const drawWidth = sourceWidth * scale;
    const drawHeight = sourceHeight * scale;
    try {
      context.drawImage(source, (size - drawWidth) / 2, (size - drawHeight) / 2,
        drawWidth, drawHeight);
      this.lightPixels = context.getImageData(0, 0, size, size).data;
    } catch {
      // A cross-origin source can still be WebGL-sampleable with CORS while a
      // browser refuses Canvas2D readback. The deterministic angle remains a
      // complete fallback in that case.
      this.lightPixels = null;
    }
  }

  sampleLuminance(x, y) {
    if (!this.lightPixels) return 0.5;
    const size = this.lightSampleSize;
    const px = Math.max(0, Math.min(size - 1, Math.round(x * (size - 1))));
    const py = Math.max(0, Math.min(size - 1, Math.round(y * (size - 1))));
    const index = (py * size + px) * 4;
    return (this.lightPixels[index] * 0.2126
      + this.lightPixels[index + 1] * 0.7152
      + this.lightPixels[index + 2] * 0.0722) / 255;
  }

  lightDirection(element, width, height, fallbackAngle) {
    const positions = [-0.34, 0, 0.34];
    let gradientX = 0;
    let gradientY = 0;
    for (const sampleY of positions) {
      for (const sampleX of positions) {
        const x = (element.x + element.w * (0.5 + sampleX)) / Math.max(width, 1);
        const y = (element.y + element.h * (0.5 + sampleY)) / Math.max(height, 1);
        const light = this.sampleLuminance(x, y);
        gradientX += sampleX * light;
        gradientY += sampleY * light;
      }
    }
    const radians = fallbackAngle * Math.PI / 180;
    const fallbackX = Math.cos(radians);
    const fallbackY = Math.sin(radians);
    const contrast = Math.hypot(gradientX, gradientY) / positions.length;
    if (contrast < 0.008) return [fallbackX, fallbackY];

    const length = Math.hypot(gradientX, gradientY) || 1;
    const autoX = -gradientX / length;
    const autoY = gradientY / length;
    const rawStrength = Math.max(0, Math.min(1, (contrast - 0.015) / 0.13));
    // Keep the environment influential without allowing a moving high-contrast
    // edge to rotate the key light almost 180 degrees from one sample to the next.
    const strength = rawStrength * rawStrength * (3 - 2 * rawStrength) * 0.58;
    const mixedX = fallbackX * (1 - strength) + autoX * strength;
    const mixedY = fallbackY * (1 - strength) + autoY * strength;
    const mixedLength = Math.hypot(mixedX, mixedY) || 1;
    return [mixedX / mixedLength, mixedY / mixedLength];
  }

  tintLightForElement(element, width, height) {
    if (element.tintTone === 'light') return 1;
    if (element.tintTone === 'dark') return 0;
    const positions = [-0.34, 0, 0.34];
    let luminance = 0;
    for (const sampleY of positions) {
      for (const sampleX of positions) {
        const x = (element.x + element.w * (0.5 + sampleX)) / Math.max(width, 1);
        const y = (element.y + element.h * (0.5 + sampleY)) / Math.max(height, 1);
        luminance += this.sampleLuminance(x, y);
      }
    }
    const average = luminance / (positions.length * positions.length);
    const t = Math.max(0, Math.min(1, (average - 0.22) / (0.50 - 0.22)));
    return t * t * (3 - 2 * t);
  }

  render(options = {}) {
    if (this.renderer.lost) return this;
    const width = this.canvas.clientWidth || this.canvas.width || 1;
    const height = this.canvas.clientHeight || this.canvas.height || 1;
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    const resized = width !== this.lastFrame.width || height !== this.lastFrame.height
      || dpr !== this.lastFrame.dpr;
    const liveBackdrop = this.renderer.hasLiveBackdrop();
    if (!options.force && !this.dirty && !resized && !liveBackdrop) return this;

    this.resize(width, height, dpr);
    const now = globalThis.performance?.now?.() ?? Date.now();
    if (this.backdropDirty || resized || liveBackdrop) {
      this.renderer.buildBackdrop(this.wallpaperIndex, this.wallpaperZoom);
      // The optical backdrop remains fully live, but the low-resolution light
      // probe runs at a steadier cadence. This decouples moving content from the
      // white key highlight and removes single-frame direction spikes.
      const refreshLiveLight = liveBackdrop && now - this.lastLightFieldUpdate >= 84;
      if (this.lightFieldDirty || resized || refreshLiveLight) {
        this.updateLightField();
        this.lastLightFieldUpdate = now;
      }
      this.backdropDirty = false;
    }
    if (this.compositeMode === 'overlay') this.renderer.clearOutput();
    else this.renderer.drawBackdrop();

    const material = this.effectiveMaterial;
    const elapsed = this.lastLightBlendTime ? Math.min(100, now - this.lastLightBlendTime) : 100;
    const blend = liveBackdrop ? 1 - Math.exp(-elapsed / 280) : 1;
    const activeLightIds = new Set(this.elements.map((element) => element.id));
    for (const id of this.smoothedLightDirections.keys()) {
      if (!activeLightIds.has(id)) this.smoothedLightDirections.delete(id);
    }
    const lightDirections = this.elements.map((element) => {
      const target = this.lightDirection(element, width, height, material.lightAngle);
      const previous = this.smoothedLightDirections.get(element.id);
      if (!previous || blend >= 1) {
        this.smoothedLightDirections.set(element.id, target);
        return target;
      }
      const mixedX = previous[0] * (1 - blend) + target[0] * blend;
      const mixedY = previous[1] * (1 - blend) + target[1] * blend;
      const length = Math.hypot(mixedX, mixedY) || 1;
      const direction = [mixedX / length, mixedY / length];
      this.smoothedLightDirections.set(element.id, direction);
      return direction;
    });
    const tintLights = this.elements.map((element) => (
      this.tintLightForElement(element, width, height)
    ));
    this.lastLightBlendTime = now;
    if (this.elements.length > MAX_GLASS_SHAPES && !this.warnedShapeLimit) {
      this.warnedShapeLimit = true;
      console.warn(`LiquidGlassWebGLV2: more than ${MAX_GLASS_SHAPES} shapes require multiple passes; overlapping shapes across a pass boundary may composite differently.`);
    }
    for (let i = 0; i < this.elements.length; i += MAX_GLASS_SHAPES) {
      this.renderer.drawGlassV2Group(
        this.elements.slice(i, i + MAX_GLASS_SHAPES),
        material,
        dpr,
        lightDirections.slice(i, i + MAX_GLASS_SHAPES),
        tintLights.slice(i, i + MAX_GLASS_SHAPES),
      );
    }

    this.dirty = false;
    this.lastFrame = { width, height, dpr };
    return this;
  }

  destroy() {
    this.stop();
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost, false);
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored, false);
    this.reducedTransparencyQuery?.removeEventListener?.('change', this.handleReducedTransparencyChange);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.renderer.destroy();
    this.elements = [];
    this.backdrops = [];
    this.lightPixels = null;
    this.lightCanvas = null;
    this.smoothedLightDirections.clear();
  }
}



export { VS_FULLSCREEN, VS_GLASS, FS_BLIT, FS_DOWN, FS_UP, FS_WALLPAPER, FS_GLASS, FS_GLASS_V2, MAX_GLASS_SHAPES, SHAPE_TYPES, shapeTypeOf, cornerRadiusOf, sdSquircle, sdPrimitive, sdGroup, hitTestElements, sdRenderedGroups, connectedElementGroups, groupElements, SHAPE_TYPES_V2, shapeTypeOfV2, sdRoundBoxV2, smoothUnionV2, cornerRadiusV2, sdElementV2, distanceToElementsV2, hitTestElementsV2, DEFAULT_MATERIAL_V2, REDUCED_TRANSPARENCY_MATERIAL_V2, SLIDERS_V2, getDefaultMaterialV2, makeMaterialV2, MIPS, GlassRenderer, LiquidGlassWebGLV2 };
