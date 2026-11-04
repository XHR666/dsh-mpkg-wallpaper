/**
 * The types here are hand copied from peggy's peg.d.ts file so that end
 * consumers of the GLSL parser can use the error type without me having to
 * fully publish peggy as a dependency of this module.
 *
 * The primary exported type is GlslSyntaxError.
 */
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
/**
 * Peggy's default error type is complete nonsense. It has the horrific
 * format() API to get a useful error message.
 */
var GlslSyntaxError = /** @class */ (function (_super) {
    __extends(GlslSyntaxError, _super);
    function GlslSyntaxError(source, grammarSource, error) {
        // End users shouldn't have to deal with this - this line is the main
        // purpose of this class. #format() is what gives an ASCII formatted error
        // message with ASCII arrows pointing to the location of the source. For
        // example, this format method produces something like
        //     Error: Expected end of input but "#" found.
        //     --> location:3:5
        //     |
        //     3 |     #ifdef RENORMALZE_REFLECTANCE
        //     |     ^
        var _this = _super.call(this, error.format([{ source: grammarSource, text: source }])) || this;
        _this.location = error.location;
        _this.expected = error.expected;
        _this.found = error.found;
        return _this;
    }
    return GlslSyntaxError;
}(Error));
export { GlslSyntaxError };
// When the error is formatted, this is the string that shows before the
// location text. For example this becomes "location:3:5".
export var DEFAULT_GRAMMAR_SOURCE = 'location';
/**
 * Wrap the peggy parser to catch the built in SyntaxError and throw a
 * formatted GlslSyntaxError instead.
 */
export var formatError = function (parser, grammarSource
// Some gymanastics to forward the return type of the parser so the exported
// parse() function has the right types
) {
    if (grammarSource === void 0) { grammarSource = DEFAULT_GRAMMAR_SOURCE; }
    return function () {
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        var src = args[0], options = args[1];
        try {
            return parser.parse(src, __assign({ grammarSource: grammarSource }, options));
        }
        catch (e) {
            if (e instanceof parser.SyntaxError) {
                throw new GlslSyntaxError(src, grammarSource, e);
            }
            throw e;
        }
    };
};
