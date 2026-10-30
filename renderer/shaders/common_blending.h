// Original implementation for this project; API-compatible with the shader includes used here. No third-party code.
//
// common_blending.h — colour blending used by the effect shaders.
//
// The formulas are the public "Photoshop style" blend definitions (plus the
// HSL-based colour/saturation/hue/luminosity trio) written from scratch for this
// project. Helper names are prefixed `wsc` so that they cannot collide with
// functions declared by the wallpaper shaders that include this file; the names
// the call sites depend on (Desaturate / RGBToHSL / HueToRGB / HSLToRGB /
// ApplyBlending / BlendOpacity / BlendLinearDodge) are kept.

// ---------------------------------------------------------------------------
// Desaturation
// ---------------------------------------------------------------------------
vec4 Desaturate(vec3 color, float amount)
{
	vec3 grey = vec3(dot(color, vec3(0.30, 0.59, 0.11)));
	return vec4(mix(color, grey, amount), 1.0);
}

// ---------------------------------------------------------------------------
// HSL <-> RGB
// ---------------------------------------------------------------------------
vec3 RGBToHSL(vec3 color)
{
	float hi = max(max(color.r, color.g), color.b);
	float lo = min(min(color.r, color.g), color.b);
	float chroma = hi - lo;
	float light = (hi + lo) * 0.5;

	float hue = 0.0;
	float sat = 0.0;
	if (chroma > 0.0)
	{
		sat = chroma / (1.0 - abs(2.0 * light - 1.0));
		if (hi == color.r)
			hue = (color.g - color.b) / chroma;
		else if (hi == color.g)
			hue = (color.b - color.r) / chroma + 2.0;
		else
			hue = (color.r - color.g) / chroma + 4.0;
		hue = fract(hue / 6.0);
	}
	return vec3(hue, sat, light);
}

float HueToRGB(float f1, float f2, float hue)
{
	float h = hue;
	if (h < 0.0)
		h += 1.0;
	else if (h > 1.0)
		h -= 1.0;

	// Piecewise ramp: up, flat, down over the three thirds of the wheel.
	if (h < 1.0 / 6.0)
		return f1 + (f2 - f1) * 6.0 * h;
	if (h < 1.0 / 2.0)
		return f2;
	if (h < 2.0 / 3.0)
		return f1 + (f2 - f1) * (2.0 / 3.0 - h) * 6.0;
	return f1;
}

vec3 HSLToRGB(vec3 hsl)
{
	float light = hsl.z;
	float sat = hsl.y;
	// f2 is the "upper" end of the ramp, f1 the "lower" one; for sat == 0 both
	// collapse onto `light`, which is what makes greys come out neutral.
	float f2 = light < 0.5 ? light * (1.0 + sat) : (light + sat) - (sat * light);
	float f1 = 2.0 * light - f2;
	return vec3(HueToRGB(f1, f2, hsl.x + (1.0 / 3.0)),
	            HueToRGB(f1, f2, hsl.x),
	            HueToRGB(f1, f2, hsl.x - (1.0 / 3.0)));
}

// ---------------------------------------------------------------------------
// Per-channel blend terms
// ---------------------------------------------------------------------------
float wscSoftLightChannel(float base, float blend)
{
	if (blend < 0.5)
		return 2.0 * base * blend + base * base * (1.0 - 2.0 * blend);
	return sqrt(base) * (2.0 * blend - 1.0) + 2.0 * base * (1.0 - blend);
}

float wscOverlayChannel(float base, float blend)
{
	if (base < 0.5)
		return 2.0 * base * blend;
	return 1.0 - 2.0 * (1.0 - base) * (1.0 - blend);
}

float wscColorDodgeChannel(float base, float blend)
{
	if (blend == 1.0)
		return blend;
	return min(base / (1.0 - blend), 1.0);
}

float wscColorBurnChannel(float base, float blend)
{
	if (blend == 0.0)
		return blend;
	return max(1.0 - (1.0 - base) / blend, 0.0);
}

float wscReflectChannel(float base, float blend)
{
	if (blend == 1.0)
		return blend;
	return min(base * base / (1.0 - blend), 1.0);
}

float wscVividLightChannel(float base, float blend)
{
	if (blend < 0.5)
		return wscColorBurnChannel(base, 2.0 * blend);
	return wscColorDodgeChannel(base, 2.0 * (blend - 0.5));
}

float wscLinearLightChannel(float base, float blend)
{
	if (blend < 0.5)
		return max(base + 2.0 * blend - 1.0, 0.0);
	return min(base + 2.0 * (blend - 0.5), 1.0);
}

float wscPinLightChannel(float base, float blend)
{
	if (blend < 0.5)
		return min(base, 2.0 * blend);
	return max(base, 2.0 * (blend - 0.5));
}

float wscHardMixChannel(float base, float blend)
{
	if (wscVividLightChannel(base, blend) < 0.5)
		return 0.0;
	return 1.0;
}

// ---------------------------------------------------------------------------
// Vector blend terms (component-wise use of the helpers above)
// ---------------------------------------------------------------------------
vec3 wscBlendDarken(vec3 A, vec3 B)     { return min(A, B); }
vec3 wscBlendLighten(vec3 A, vec3 B)    { return max(A, B); }
vec3 wscBlendMultiply(vec3 A, vec3 B)   { return A * B; }
vec3 wscBlendAverage(vec3 A, vec3 B)    { return (A + B) * 0.5; }
vec3 wscBlendAdd(vec3 A, vec3 B)        { return min(A + B, vec3(1.0)); }
vec3 wscBlendLinearBurn(vec3 A, vec3 B) { return max(A + B - vec3(1.0), vec3(0.0)); }
vec3 wscBlendDifference(vec3 A, vec3 B) { return abs(A - B); }
vec3 wscBlendExclusion(vec3 A, vec3 B)  { return A + B - 2.0 * A * B; }
vec3 wscBlendNegation(vec3 A, vec3 B)   { return vec3(1.0) - abs(vec3(1.0) - A - B); }
vec3 wscBlendPhoenix(vec3 A, vec3 B)    { return min(A, B) - max(A, B) + vec3(1.0); }
vec3 wscBlendScreen(vec3 A, vec3 B)     { return vec3(1.0) - (vec3(1.0) - A) * (vec3(1.0) - B); }
vec3 wscBlendTint(vec3 A, vec3 B)       { return vec3(max(A.r, max(A.g, A.b))) * B; }

vec3 wscBlendOverlay(vec3 A, vec3 B)
{
	return vec3(wscOverlayChannel(A.r, B.r), wscOverlayChannel(A.g, B.g), wscOverlayChannel(A.b, B.b));
}

vec3 wscBlendSoftLight(vec3 A, vec3 B)
{
	return vec3(wscSoftLightChannel(A.r, B.r), wscSoftLightChannel(A.g, B.g), wscSoftLightChannel(A.b, B.b));
}

vec3 wscBlendHardLight(vec3 A, vec3 B)
{
	return wscBlendOverlay(B, A);
}

vec3 wscBlendColorDodge(vec3 A, vec3 B)
{
	return vec3(wscColorDodgeChannel(A.r, B.r), wscColorDodgeChannel(A.g, B.g), wscColorDodgeChannel(A.b, B.b));
}

vec3 wscBlendColorBurn(vec3 A, vec3 B)
{
	return vec3(wscColorBurnChannel(A.r, B.r), wscColorBurnChannel(A.g, B.g), wscColorBurnChannel(A.b, B.b));
}

vec3 wscBlendReflect(vec3 A, vec3 B)
{
	return vec3(wscReflectChannel(A.r, B.r), wscReflectChannel(A.g, B.g), wscReflectChannel(A.b, B.b));
}

vec3 wscBlendGlow(vec3 A, vec3 B)
{
	return wscBlendReflect(B, A);
}

vec3 wscBlendVividLight(vec3 A, vec3 B)
{
	return vec3(wscVividLightChannel(A.r, B.r), wscVividLightChannel(A.g, B.g), wscVividLightChannel(A.b, B.b));
}

vec3 wscBlendLinearLight(vec3 A, vec3 B)
{
	return vec3(wscLinearLightChannel(A.r, B.r), wscLinearLightChannel(A.g, B.g), wscLinearLightChannel(A.b, B.b));
}

vec3 wscBlendPinLight(vec3 A, vec3 B)
{
	return vec3(wscPinLightChannel(A.r, B.r), wscPinLightChannel(A.g, B.g), wscPinLightChannel(A.b, B.b));
}

vec3 wscBlendHardMix(vec3 A, vec3 B)
{
	return vec3(wscHardMixChannel(A.r, B.r), wscHardMixChannel(A.g, B.g), wscHardMixChannel(A.b, B.b));
}

// HSL-space combinations: take hue / saturation / lightness from one operand and
// the remaining two components from the other.
vec3 wscBlendHue(vec3 A, vec3 B)
{
	vec3 hslA = RGBToHSL(A);
	vec3 hslB = RGBToHSL(B);
	return HSLToRGB(vec3(hslB.x, hslA.y, hslA.z));
}

vec3 wscBlendSaturation(vec3 A, vec3 B)
{
	vec3 hslA = RGBToHSL(A);
	vec3 hslB = RGBToHSL(B);
	return HSLToRGB(vec3(hslA.x, hslB.y, hslA.z));
}

vec3 wscBlendColor(vec3 A, vec3 B)
{
	vec3 hslA = RGBToHSL(A);
	vec3 hslB = RGBToHSL(B);
	return HSLToRGB(vec3(hslB.x, hslB.y, hslA.z));
}

vec3 wscBlendLuminosity(vec3 A, vec3 B)
{
	vec3 hslA = RGBToHSL(A);
	vec3 hslB = RGBToHSL(B);
	return HSLToRGB(vec3(hslA.x, hslA.y, hslB.z));
}

// ---------------------------------------------------------------------------
// Mode dispatch
// ---------------------------------------------------------------------------
// A = existing pixel (base), B = incoming effect colour, opacity = strength.
// The selector is a compile-time combo in practice (the transpiler substitutes
// the literal before GLSL compilation), so the switch folds away.
vec3 ApplyBlending(const int blendMode, vec3 A, vec3 B, float opacity)
{
	switch (blendMode)
	{
		case 1:  return mix(A, wscBlendDarken(A, B), opacity);
		case 2:  return mix(A, wscBlendMultiply(A, B), opacity);
		case 3:  return mix(A, wscBlendColorBurn(A, B), opacity);
		case 4:  return mix(A, wscBlendLinearBurn(A, B), opacity);
		case 5:  return wscBlendDarken(A, B);
		case 6:  return mix(A, wscBlendLighten(A, B), opacity);
		case 7:  return mix(A, wscBlendScreen(A, B), opacity);
		case 8:  return mix(A, wscBlendColorDodge(A, B), opacity);
		case 9:  return mix(A, wscBlendAdd(A, B), opacity);
		case 10: return wscBlendLighten(A, B);
		case 11: return mix(A, wscBlendOverlay(A, B), opacity);
		case 12: return mix(A, wscBlendSoftLight(A, B), opacity);
		case 13: return mix(A, wscBlendHardLight(A, B), opacity);
		case 14: return mix(A, wscBlendVividLight(A, B), opacity);
		case 15: return mix(A, wscBlendLinearLight(A, B), opacity);
		case 16: return mix(A, wscBlendPinLight(A, B), opacity);
		case 17: return mix(A, wscBlendHardMix(A, B), opacity);
		case 18: return mix(A, wscBlendDifference(A, B), opacity);
		case 19: return mix(A, wscBlendExclusion(A, B), opacity);
		case 20: return mix(A, wscBlendLinearBurn(A, B), opacity);
		case 21: return mix(A, wscBlendReflect(A, B), opacity);
		case 22: return mix(A, wscBlendGlow(A, B), opacity);
		case 23: return mix(A, wscBlendPhoenix(A, B), opacity);
		case 24: return mix(A, wscBlendAverage(A, B), opacity);
		case 25: return mix(A, wscBlendNegation(A, B), opacity);
		case 26: return mix(A, wscBlendHue(A, B), opacity);
		case 27: return mix(A, wscBlendSaturation(A, B), opacity);
		case 28: return mix(A, wscBlendColor(A, B), opacity);
		case 29: return mix(A, wscBlendLuminosity(A, B), opacity);
		case 30: return mix(A, wscBlendTint(A, B), opacity);
		case 31: return A + B * opacity;
	}
	// Mode 0 and any out-of-range selector: plain alpha mix.
	return mix(A, B, opacity);
}

// float overload. The combo substitution in the HLSL->GLSL pipeline writes
// numeric combo values as plain GLSL literals, but package shaders that spell
// the selector out by hand write a float literal (`ApplyBlending(0.0, ...)`).
// That is legal in HLSL and rejected by GLSL ES, which has no float->int
// implicit conversion ("no matching overloaded function found"), and a pass
// that fails to compile is only console.warn'd and then skipped -- the effect
// silently disappears (circular_text and friends). Rounding to nearest keeps
// the authored values exact; int call sites still bind the `const int`
// overload above exactly, so this is additive.
vec3 ApplyBlending(float blendMode, vec3 A, vec3 B, float opacity)
{
	return ApplyBlending(int(blendMode + 0.5), A, B, opacity);
}

// ---------------------------------------------------------------------------
// Macro API
// ---------------------------------------------------------------------------
// `BlendOpacity` takes the blend term as a macro argument, so the two names used
// by package shaders that call it are kept here.
#define BlendLinearDodge(base, blend) min(base + blend, vec3(1.0))
#define BlendOpacity(base, blend, F, O) mix(base, F(base, blend), O)
