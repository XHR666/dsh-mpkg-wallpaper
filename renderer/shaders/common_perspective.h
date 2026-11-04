// Original implementation for this project; API-compatible with the shader includes used here. No third-party code.
//
// common_perspective.h — projective (perspective-correct) mapping helpers.
//
// squareToQuad builds the homography that maps the unit square onto an arbitrary
// quad; the lightshaft / water-wave vertex shaders invert it and use the result to
// turn normalised UVs into the effect's own coordinate frame.
//
// Derivation notes: for corners mapped as
//   (0,0) -> p0   (1,0) -> p1   (1,1) -> p2   (0,1) -> p3
// the homography is the classical unit-square-to-quad transform (Heckbert,
// "Fundamentals of Texture Mapping and Image Warping", and the standard
// square-to-quad form used by every perspective transform implementation):
// the affine part is read off the corner differences and the two projective
// terms come from solving the 2x2 system in the quad's "non-parallelogramness".
//
// NOTE on `inverse`: this project compiles the shaders to GLSL ES 3.00, where
// inverse() is a built-in for mat2/mat3/mat4 - so the call sites keep working
// without a user definition. The HLSL-dialect definition below is kept only for
// consumers that compile the same sources with an HLSL front end; it is guarded
// so that it never collides with the GLSL built-in.

mat3 squareToQuad(vec2 p0, vec2 p1, vec2 p2, vec2 p3)
{
	// Corner differences relative to the (1,1) corner, plus the amount by which
	// the quad fails to be a parallelogram.
	vec2 d10 = p1 - p2;
	vec2 d01 = p3 - p2;
	vec2 skew = p0 - p1 + p2 - p3;

	float det = d10.x * d01.y - d01.x * d10.y;

	if (det == 0.0 || (skew.x == 0.0 && skew.y == 0.0))
	{
		// Affine: the quad is a parallelogram (or degenerate), so the mapping
		// needs no projective terms.
		return mat3(p1.x - p0.x, p1.y - p0.y, 0.0,
		            p3.x - p0.x, p3.y - p0.y, 0.0,
		            p0.x, p0.y, 1.0);
	}

	// Solve for the two projective coefficients and fold them into the columns
	// so the result can be applied as m * vec3(u, v, 1).
	float g = (skew.x * d01.y - d01.x * skew.y) / det;
	float h = (d10.x * skew.y - skew.x * d10.y) / det;

	return mat3(p1.x - p0.x + g * p1.x, p1.y - p0.y + g * p1.y, g,
	            p3.x - p0.x + h * p3.x, p3.y - p0.y + h * p3.y, h,
	            p0.x, p0.y, 1.0);
}

#if HLSL
// Adjugate-based 3x3 inverse (column-major m[column][row], as in HLSL/GLSL).
mat3 inverse(mat3 m)
{
	float c00 = m[1][1] * m[2][2] - m[1][2] * m[2][1];
	float c10 = m[1][2] * m[2][0] - m[1][0] * m[2][2];
	float c20 = m[1][0] * m[2][1] - m[1][1] * m[2][0];
	float det = m[0][0] * c00 + m[0][1] * c10 + m[0][2] * c20;
	float inv = 1.0 / det;
	return mat3(
		c00 * inv, (m[0][2] * m[2][1] - m[0][1] * m[2][2]) * inv, (m[0][1] * m[1][2] - m[0][2] * m[1][1]) * inv,
		c10 * inv, (m[0][0] * m[2][2] - m[0][2] * m[2][0]) * inv, (m[0][2] * m[1][0] - m[0][0] * m[1][2]) * inv,
		c20 * inv, (m[0][1] * m[2][0] - m[0][0] * m[2][1]) * inv, (m[0][0] * m[1][1] - m[0][1] * m[1][0]) * inv);
}
#endif
