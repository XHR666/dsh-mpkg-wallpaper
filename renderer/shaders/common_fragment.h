// Original implementation for this project; API-compatible with the shader includes used here. No third-party code.
//
// common_fragment.h — texture-format identifiers and the small conversion helpers
// that the effect shaders use when a sampler's format is not plain RGBA.
//
// Keep the numeric values: they are the texture format ids this renderer's
// pipeline reports through the TEX0FORMAT / TEX1FORMAT / TEX2FORMAT combos, and
// package shaders compare against them in #if expressions.
//
// The normal-map / PBR lighting helpers that also live in this file historically
// are not used anywhere in this project and are intentionally not carried over.

#define FORMAT_RGBA8888  0
#define FORMAT_RGB888    1
#define FORMAT_RGB565    2

#define FORMAT_ETC1_RGB8 3
#define FORMAT_DXT5      4
#define FORMAT_ETC2_RGBA8 5
#define FORMAT_DXT3      6
#define FORMAT_DXT1      7

#define FORMAT_RG88      8
#define FORMAT_R8        9
#define FORMAT_RG1616F   10
#define FORMAT_R16F      11

#define FORMAT_BC7       12

// Single-channel formats store their value in the red channel.
float ConvertSampleR8(vec4 texel)
{
	return texel.r;
}

// Expands a two-channel (RG) texture into RGB by reusing the green channel, and
// a single-channel (R) texture into an opaque white/grey with the value in red.
vec4 ConvertTexture0Format(vec4 texel)
{
#if TEX0FORMAT == FORMAT_RG88 || TEX0FORMAT == FORMAT_RG1616F
	return texel.rrrg;
#endif
#if TEX0FORMAT == FORMAT_R8 || TEX0FORMAT == FORMAT_R16F
	return vec4(1.0, 1.0, 1.0, texel.r);
#endif
	return texel;
}

// Same conversion for a format id known only at run time.
vec4 ConvertTextureFormat(const int format, vec4 texel)
{
	if (format == FORMAT_RG88 || format == FORMAT_RG1616F)
		return texel.rrrg;
	if (format == FORMAT_R8 || format == FORMAT_R16F)
		return vec4(1.0, 1.0, 1.0, texel.r);
	return texel;
}

// ---------------------------------------------------------------------------
// 2D point-light helpers (P-208 B1, 2026-09-29). Own implementation for this
// project; the per-light terms match the renderer's CPU-side 2D light model:
//   * attenuation  a = saturate((radius - dist) / radius), applied SQUARED;
//   * diffuse term mixed between raw lambert and half-lambert by g_Light;
//   * rim term driven by the un-mixed half-lambert value and metallic*2;
//   * contribution = color * (saturate(lightDot) + rim) * a * a.
// These functions are only pulled in by shaders that declare the light
// uniforms themselves (g_LightsColorRadius / g_LightsPosition / g_Light...);
// shaders that never reference them are unaffected.
// ---------------------------------------------------------------------------

float LightSaturate1(float x)
{
	return clamp(x, 0.0, 1.0);
}

// Diffuse-only per-light contribution (no specular/rim branch).
vec3 ComputeLight2D(vec3 lightDelta, vec3 normal, vec3 color, float radius)
{
	float dist = length(lightDelta);
	float attn = radius > 0.0 ? LightSaturate1((radius - dist) / radius) : 0.0;
	vec3 dir = dist > 0.0 ? lightDelta / dist : vec3(0.0);
	float ndl = dot(dir, normal);
	return color * LightSaturate1(ndl) * attn * attn;
}

// Full per-light contribution. `specAccum` receives this light's specular
// increment; the return value is the diffuse+rim term.
vec3 ComputeLightSpecular2D(vec3 normal, vec3 lightDelta, vec3 color, float radius,
                            vec3 viewDir, float specularPower, float specularStrength,
                            float gLight, float metallic, inout vec3 specAccum)
{
	float dist = length(lightDelta);
	float attn = radius > 0.0 ? LightSaturate1((radius - dist) / radius) : 0.0;
	vec3 dir = dist > 0.0 ? lightDelta / dist : vec3(0.0);
	vec3 halfVec = normalize(viewDir + dir);
	float spec = max(0.0, dot(halfVec, normal));
	specAccum += pow(spec, specularPower) * specularStrength * attn * color;
	float lightDot = dot(dir, normal);
	float halfLambertLight = lightDot * 0.5 + 0.5;
	lightDot = mix(lightDot, halfLambertLight, clamp(gLight, 0.0, 1.0));
	float rimTerm = metallic * 2.0;
	float rim = pow((1.0 - LightSaturate1(dot(normal, viewDir))) * pow(halfLambertLight, 0.25), 6.0 - rimTerm) * rimTerm;
	return color * (LightSaturate1(lightDot) + rim) * attn * attn;
}

// Ambient term: skylight on the floor-facing hemisphere, ambient elsewhere.
vec3 AmbientMix2D(vec3 skylight, vec3 ambient, float normalY)
{
	return mix(skylight, ambient, clamp(normalY * 0.5 + 0.5, 0.0, 1.0));
}
