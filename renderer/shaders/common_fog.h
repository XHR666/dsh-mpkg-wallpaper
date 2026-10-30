// Original implementation for this project; API-compatible with the shader includes used here. No third-party code.
//
// common_fog.h — distance/height fog helpers (P-208 B2, 2026-09-29).
//
// Served to package shaders that `#include "common_fog.h"` and gate on the
// FOG_DIST / FOG_HEIGHT material combos (the FOG combo family defaults to 1 on
// materials that opt into the editor's fog properties). The renderer uploads
// the matching uniforms only when the scene itself declares fog fields, so a
// shader compiled with FOG_DIST==1 in a fog-less scene samples the GL uniform
// defaults — the same values it would see if this header were absent.
//
// Component layout of the vec4 params (single source of truth is the renderer's
// computeFogUniforms): x = start, y = range (end − start), z = base intensity
// (start density), w = quadratic coefficient (end density).

float FogSaturate1(float x)
{
	return clamp(x, 0.0, 1.0);
}

// Per-pixel fog coordinates: normalized distance and height factors.
vec2 CalculateFogPixelState(float viewDirLength, float worldPosHeight)
{
	vec2 result = vec2(0.0);
#if FOG_DIST
	result.x = (viewDirLength - g_FogDistanceParams.x) / g_FogDistanceParams.y;
#endif
#if FOG_HEIGHT
	result.y = (worldPosHeight - g_FogHeightParams.x) / g_FogHeightParams.y;
#endif
	return result;
}

// Blend fog color over an RGB color. Height fog applies first, then distance
// fog (the same order the renderer's CPU reference uses).
vec3 ApplyFog(vec3 color, vec2 fogPixelState)
{
#if FOG_HEIGHT
	float fogHeight = FogSaturate1(fogPixelState.y);
	color = mix(color, g_FogHeightColor,
		g_FogHeightParams.z + g_FogHeightParams.w * fogHeight * fogHeight);
#endif
#if FOG_DIST
	float fogDistance = FogSaturate1(fogPixelState.x);
	color = mix(color, g_FogDistanceColor,
		g_FogDistanceParams.z + g_FogDistanceParams.w * fogDistance * fogDistance);
#endif
	return color;
}

// Alpha fades out with the stronger of the two fog factors: a * (1 - f^2).
float ApplyFogAlpha(float alpha, vec2 fogPixelState)
{
#if FOG_DIST
	float fogDistance = FogSaturate1(fogPixelState.x);
	fogDistance = g_FogDistanceParams.z + g_FogDistanceParams.w * fogDistance * fogDistance;
#else
	float fogDistance = 0.0;
#endif
#if FOG_HEIGHT
	float fogHeight = FogSaturate1(fogPixelState.y);
	fogHeight = g_FogHeightParams.z + g_FogHeightParams.w * fogHeight * fogHeight;
#else
	float fogHeight = 0.0;
#endif
	float fogFactor = FogSaturate1(max(fogDistance, fogHeight));
	return alpha * (1.0 - (fogFactor * fogFactor));
}
