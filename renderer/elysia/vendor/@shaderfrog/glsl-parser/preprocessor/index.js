import generate from './generator.js';
import { preprocessAst, preprocessComments, visitPreprocessedAst, } from './preprocessor.js';
import { formatError } from '../error.js';
// This index file is currently only for package publishing, where the whole
// library exists in the dist/ folder, so the below import is relative to dist/
import * as parser from './preprocessor-parser.js';
/**
 * This is the main entry point for the preprocessor. It parses the source
 * code and returns an AST. It protects the user from the horrific peggy
 * SyntaxError, by wrapping it in a nicer custom error.
 */
var parse = function (src, options) {
    return formatError(parser)((options === null || options === void 0 ? void 0 : options.preserveComments) ? src : preprocessComments(src), options);
};
var preprocess = function (src, options) {
    return generate(preprocessAst(parse(src, options), options));
};
export default preprocess;
export { parse, preprocessAst, preprocessComments, generate, preprocess, parser, visitPreprocessedAst, };
