// Original implementation for this project; API-compatible with the shader includes used here. No third-party code.
//
// common_blur.h — separable Gaussian blur kernels used by the blur effect passes.
//
// The kernels are discrete Gaussians g(n) = exp(-n^2 / (2*sigma^2)), normalised
// over the tap range, sampled at integer offsets. Adjacent taps are folded into
// single bilinear fetches: a pair (n, n+1) contributes one sample located at its
// centre of mass n + g(n+1)/(g(n)+g(n+1)) with weight g(n)+g(n+1). This is the
// textbook "linear-sampling" Gaussian optimisation and it is what keeps 13 taps
// down to 7 texture reads, 7 taps down to 4 and 3 taps down to 3 (the 3-tap case
// is the plain binomial [1 2 1]/4 at a spacing of one step).
//
// sigma was chosen per tap count so that the folded offsets/weights reproduce the
// filter response this project's blur passes were tuned against (sigma ~ 2.02086
// for 13 taps, ~ 2.02091 for 7 taps); the residual of that fit is <= 1.1e-4 on the
// offsets and <= 7.3e-6 on the weights, i.e. far below one 8-bit output step.
// See docs/COMMON-HEADERS-REPLACEMENT.md (appendix) for the generator.

// Counter-clockwise rotation of a 2D vector, used by the radial kernels which
// rotate the sample offset around the blur centre instead of translating it.
vec2 wscBlurRotate(vec2 v, float angle)
{
	float s = sin(angle);
	float c = cos(angle);
	return vec2(v.x * c - v.y * s, v.x * s + v.y * c);
}

// --- 13-tap Gaussian, folded into 1 + 3 bilinear pairs ----------------------
vec4 blur13a(vec2 uv, vec2 texelStep)
{
	vec4 sum = texSample2D(g_Texture0, uv) * 0.1976406528809576;
	sum += (texSample2D(g_Texture0, uv + texelStep * 1.4091998770852122)
	      + texSample2D(g_Texture0, uv - texelStep * 1.4091998770852122)) * 0.2959855056006557;
	sum += (texSample2D(g_Texture0, uv + texelStep * 3.2979348079914822)
	      + texSample2D(g_Texture0, uv - texelStep * 3.2979348079914822)) * 0.0935333619980593;
	sum += (texSample2D(g_Texture0, uv + texelStep * 5.2062900776825969)
	      + texSample2D(g_Texture0, uv - texelStep * 5.2062900776825969)) * 0.0116608059608062;
	return sum;
}

// --- 7-tap Gaussian, folded into 4 bilinear fetches ------------------------
// The pack is {+0,+1}, {+2,+3}, {-1,-2} and the lone tap -3.
vec4 blur7a(vec2 uv, vec2 texelStep)
{
	vec4 sum = texSample2D(g_Texture0, uv + texelStep * 0.469433779698372) * 0.4044856614512112;
	sum += texSample2D(g_Texture0, uv + texelStep * 2.3515644035337887) * 0.2028175528299753;
	sum += texSample2D(g_Texture0, uv - texelStep * 1.4091998770852121) * 0.3213933537319605;
	sum += texSample2D(g_Texture0, uv - texelStep * 3.0) * 0.0713034319868530;
	return sum;
}

// --- 3-tap binomial --------------------------------------------------------
vec4 blur3a(vec2 uv, vec2 texelStep)
{
	return texSample2D(g_Texture0, uv + texelStep) * 0.25
	     + texSample2D(g_Texture0, uv) * 0.5
	     + texSample2D(g_Texture0, uv - texelStep) * 0.25;
}

// --- Radial variants: same weights, offsets used as rotation angles --------
// Call sites pass a small strength value which is scaled into the angle range
// (0.025 rad per unit, matching the effect's "scale" parameter).
vec4 blurRadial13a(vec2 uv, vec2 center, float amount)
{
	vec2 delta = uv - center;
	float amt = amount * 0.025;
	vec4 sum = texSample2D(g_Texture0, uv) * 0.1976406528809576;
	sum += (texSample2D(g_Texture0, center + wscBlurRotate(delta, 1.4091998770852122 * amt))
	      + texSample2D(g_Texture0, center + wscBlurRotate(delta, -1.4091998770852122 * amt))) * 0.2959855056006557;
	sum += (texSample2D(g_Texture0, center + wscBlurRotate(delta, 3.2979348079914822 * amt))
	      + texSample2D(g_Texture0, center + wscBlurRotate(delta, -3.2979348079914822 * amt))) * 0.0935333619980593;
	sum += (texSample2D(g_Texture0, center + wscBlurRotate(delta, 5.2062900776825969 * amt))
	      + texSample2D(g_Texture0, center + wscBlurRotate(delta, -5.2062900776825969 * amt))) * 0.0116608059608062;
	return sum;
}

vec4 blurRadial7a(vec2 uv, vec2 center, float amount)
{
	vec2 delta = uv - center;
	float amt = amount * 0.025;
	vec4 sum = texSample2D(g_Texture0, center + wscBlurRotate(delta, 0.469433779698372 * amt)) * 0.4044856614512112;
	sum += texSample2D(g_Texture0, center + wscBlurRotate(delta, 2.3515644035337887 * amt)) * 0.2028175528299753;
	sum += texSample2D(g_Texture0, center + wscBlurRotate(delta, -1.4091998770852121 * amt)) * 0.3213933537319605;
	sum += texSample2D(g_Texture0, center + wscBlurRotate(delta, -3.0 * amt)) * 0.0713034319868530;
	return sum;
}

vec4 blurRadial3a(vec2 uv, vec2 center, float amount)
{
	vec2 delta = uv - center;
	float amt = amount * 0.025;
	return texSample2D(g_Texture0, center + delta) * 0.5
	     + texSample2D(g_Texture0, center + wscBlurRotate(delta, amt)) * 0.25
	     + texSample2D(g_Texture0, center + wscBlurRotate(delta, -amt)) * 0.25;
}

// --- RGB-only wrappers kept so the include stays drop-in for callers that ask
//     for the colour channels instead of the full RGBA sample ---------------
vec3 blur13(vec2 uv, vec2 texelStep) { return blur13a(uv, texelStep).rgb; }
vec3 blur7(vec2 uv, vec2 texelStep)  { return blur7a(uv, texelStep).rgb; }
vec3 blur3(vec2 uv, vec2 texelStep)  { return blur3a(uv, texelStep).rgb; }
