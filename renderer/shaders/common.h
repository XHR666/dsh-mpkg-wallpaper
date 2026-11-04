// Original implementation for this project; API-compatible with the shader includes used here. No third-party code.
//
// common.h — small shared maths helpers pulled in by the effect shaders that this
// project compiles through its HLSL-subset -> GLSL ES 3.0 pipeline.
//
// Only the entry points that the shipped shaders (and the wallpaper packages they
// come from) actually call are provided here; everything is written from the
// standard definitions of the operations involved.

// ---------------------------------------------------------------------------
// Angle / algebra constants
// ---------------------------------------------------------------------------
// The effect shaders of this dialect use these names with the following values.
// Note that M_PI_2 is a full turn here, not half of pi: package shaders rely on
// it, e.g. `(atan2(y, x) + M_PI) / M_PI_2` folds an angle into [0,1], and
// `M_PI_2 * noiseSample` is used as a 2*pi phase offset. M_PI_HALF is the
// quarter/half turn constant.
#define M_PI      3.14159265359
#define M_PI_HALF 1.57079632679
#define M_PI_2    6.28318530718
#define SQRT_2    1.41421356237
#define SQRT_3    1.73205080756

// ---------------------------------------------------------------------------
// 2D rotation
// ---------------------------------------------------------------------------
// Rotates v counter-clockwise by `angle` radians in the texture/UV frame.
// Call sites: cloud motion, shimmer, water ripple and water wave vertex shaders,
// which build a direction vector from a rotation of (0,1) or (1,0).
vec2 rotateVec2(vec2 v, float angle)
{
	float s = sin(angle);
	float c = cos(angle);
	return vec2(v.x * c - v.y * s, v.x * s + v.y * c);
}

// vec4 overload. Effect shaders are authored in HLSL's dialect, where passing a
// vec4 actual argument to a float2 parameter is an implicit truncation; GLSL ES
// has no such implicit conversion, so `rotateVec2(v_DirectionN, a)` with a vec4
// `v_DirectionN` fails to compile with "no matching overloaded function found".
// A failed pass is only console.warn'd by the renderer, so the effect silently
// disappears (multistage_wave.vert with GLOBAL_ROTATION=1 is the whole
// multi-layer ribbon/hair wave class). Truncating to .xy here restores the HLSL
// argument semantics. vec2 call sites still bind the overload above exactly
// (an exact match is preferred over a truncating one), so this is additive.
vec2 rotateVec2(vec4 v, float angle)
{
	return rotateVec2(v.xy, angle);
}

// ---------------------------------------------------------------------------
// Luminance
// ---------------------------------------------------------------------------
// Perceived brightness of an RGB colour; weights are the ones the monochrome /
// grain paths of this pipeline were built against.
float greyscale(vec3 color)
{
	return dot(color, vec3(0.11, 0.59, 0.30));
}

// ---------------------------------------------------------------------------
// HSV <-> RGB
// ---------------------------------------------------------------------------
// H is normalised to [0,1), S = chroma / value, V = max component. This is the
// convention used by the hue-shift and gradient-map effects; greys map to
// (0, 0, value).
vec3 rgb2hsv(vec3 rgb)
{
	float hi = max(rgb.r, max(rgb.g, rgb.b));
	float lo = min(rgb.r, min(rgb.g, rgb.b));
	float chroma = hi - lo;

	float hue = 0.0;
	if (chroma > 0.0)
	{
		if (hi == rgb.r)
			hue = (rgb.g - rgb.b) / chroma;
		else if (hi == rgb.g)
			hue = (rgb.b - rgb.r) / chroma + 2.0;
		else
			hue = (rgb.r - rgb.g) / chroma + 4.0;
		hue = fract(hue / 6.0);
	}

	float sat = hi > 0.0 ? chroma / hi : 0.0;
	return vec3(hue, sat, hi);
}

vec3 hsv2rgb(vec3 hsv)
{
	// Six 60-degree sectors around the colour wheel.
	float sector = fract(hsv.x) * 6.0;
	float idx = floor(sector);
	float f = sector - idx;

	float p = hsv.z * (1.0 - hsv.y);
	float q = hsv.z * (1.0 - hsv.y * f);
	float t = hsv.z * (1.0 - hsv.y * (1.0 - f));

	if (idx < 1.0)
		return vec3(hsv.z, t, p);
	if (idx < 2.0)
		return vec3(q, hsv.z, p);
	if (idx < 3.0)
		return vec3(p, hsv.z, t);
	if (idx < 4.0)
		return vec3(p, q, hsv.z);
	if (idx < 5.0)
		return vec3(t, p, hsv.z);
	return vec3(hsv.z, p, q);
}
