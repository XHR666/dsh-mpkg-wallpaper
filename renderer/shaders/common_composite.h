// Original implementation for this project; API-compatible with the shader includes used here. No third-party code.
//
// common_composite.h — "how does the effect result meet the original image?"
// compositing helper shared by the multi-pass effects (blur combine being the
// main user). COMPOSITE selects the relationship at compile time:
//   0 = effect only, 1 = effect blended over the original, 2 = effect below the
//   original, 3 = effect only where the original is transparent.
//
// The material metadata comments on the uniforms below are what the renderer's
// material -> uniform binding reads; keep the "material" keys intact.

#include "common.h"
#include "common_blending.h"

uniform float g_CompositeAlpha;  // {"material":"compositealpha","label":"ui_editor_properties_alpha","default":1,"range":[0.0, 2.0]}
uniform vec2 g_CompositeOffset;  // {"material":"compositeoffset","label":"ui_editor_properties_offset","default":"0 0","linked":true,"range":[-10.0, 10.0]}
uniform vec3 g_CompositeColor;   // {"material":"compositecolor","label":"ui_editor_properties_color","default":"1 1 1","type":"color"}

// Shifts the sample position of the effect texture by a pixel offset expressed
// in texels of that texture; disabled (identity) when there is nothing to
// composite against.
vec2 ApplyCompositeOffset(vec2 texCoords, vec2 textureResolution)
{
#if COMPOSITE != 0
	return texCoords + g_CompositeOffset / textureResolution;
#else
	return texCoords;
#endif
}

vec4 ApplyComposite(vec4 original, vec4 effect)
{
#if COMPOSITEMONO == 1
	effect.rgb = vec3(greyscale(effect.rgb));
#endif

	effect.rgb = effect.rgb * g_CompositeColor;

#if COMPOSITE == 1
	// Effect over the original: blend with the effect's own coverage, then keep
	// whichever alpha is larger (the original stays opaque where it already was).
	float over = effect.a * g_CompositeAlpha;
	effect.rgb = ApplyBlending(BLENDMODE, original.rgb, effect.rgb, over);
	effect.a = max(effect.a * clamp(g_CompositeAlpha, 0.0, 1.0), original.a);
#endif

#if COMPOSITE == 2
	// Effect under the original: fade the effect in, then let the original's own
	// alpha decide how much of it shows through.
	float under = effect.a * clamp(g_CompositeAlpha, 0.0, 1.0);
	effect = mix(vec4(effect.rgb, under), original, original.a);
#endif

#if COMPOSITE == 3
	// Effect only where the original is not: scale the effect's coverage by the
	// original's transparency.
	effect.a = effect.a * clamp(g_CompositeAlpha, 0.0, 1.0) * (1.0 - original.a);
#endif

	return effect;
}
