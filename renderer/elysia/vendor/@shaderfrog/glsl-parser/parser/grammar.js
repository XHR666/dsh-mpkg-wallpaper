/**
 * Helper functions used by preprocessor-grammar.pegjs. Also re-exports
 * functions from other files used in the grammar.
 */
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
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
import { findGlobalScope, findOverloadDefinition, findTypeScope, functionDeclarationSignature, functionUseSignature, newOverloadIndex, isDeclaredFunction, isDeclaredType, makeScopeIndex, findBindingScope, } from './scope.js';
export { findGlobalScope, findOverloadDefinition, findTypeScope, functionDeclarationSignature, functionUseSignature, newOverloadIndex, isDeclaredFunction, isDeclaredType, };
export var UNKNOWN_TYPE = 'UNKNOWN TYPE';
export var partial = function (typeNameOrAttrs, attrs) { return ({
    partial: attrs === undefined
        ? typeNameOrAttrs
        : __assign({ type: typeNameOrAttrs }, attrs),
}); };
// Filter out "empty" elements from an array
export var xnil = function () {
    var args = [];
    for (var _i = 0; _i < arguments.length; _i++) {
        args[_i] = arguments[_i];
    }
    return args
        .flat()
        .filter(function (e) { return e !== undefined && e !== null && e !== '' && e.length !== 0; });
};
// Given an array of nodes with potential null empty values, convert to text.
// Kind of like $(rule) but filters out empty rules
export var toText = function () {
    var args = [];
    for (var _i = 0; _i < arguments.length; _i++) {
        args[_i] = arguments[_i];
    }
    return xnil(args).join('');
};
export var ifOnly = function (arr) { return (arr.length > 1 ? arr : arr[0]); };
// Remove empty elements and return value if only 1 element remains
export var collapse = function () {
    var args = [];
    for (var _i = 0; _i < arguments.length; _i++) {
        args[_i] = arguments[_i];
    }
    return ifOnly(xnil(args));
};
// Create definition left associative tree of nodes
export var leftAssociate = function (head) {
    var tail = [];
    for (var _i = 1; _i < arguments.length; _i++) {
        tail[_i - 1] = arguments[_i];
    }
    return tail.flat().reduce(function (left, _a) {
        var operator = _a[0], right = _a[1];
        return ({
            type: 'binary',
            operator: operator,
            left: left,
            right: right,
        });
    }, head);
};
// From https://www.khronos.org/opengl/wiki/Built-in_Variable_(GLSL)
export var BUILT_INS = {
    vertex: new Set([
        'gl_VertexID',
        'gl_InstanceID',
        'gl_DrawID',
        'gl_BaseVertex',
        'gl_BaseInstance',
        'gl_Position',
        'gl_PointSize',
        'gl_ClipDistance',
    ]),
    fragment: new Set([
        'gl_FragColor',
        'gl_FragData',
        'gl_FragCoord',
        'gl_FrontFacing',
        'gl_PointCoord',
        'gl_SampleID',
        'gl_SamplePosition',
        'gl_SampleMaskIn',
        'gl_ClipDistance',
        'gl_PrimitiveID',
        'gl_Layer',
        'gl_ViewportIndex',
        'gl_FragDepth',
        'gl_SampleMask',
    ]),
};
// From https://www.khronos.org/registry/OpenGL-Refpages/gl4/index.php
// excluding gl_ prefixed builtins, which don't appear to be functions
export var FN_BUILT_INS = new Set([
    'abs',
    'acos',
    'acosh',
    'all',
    'any',
    'asin',
    'asinh',
    'atan',
    'atanh',
    'atomicAdd',
    'atomicAnd',
    'atomicCompSwap',
    'atomicCounter',
    'atomicCounterDecrement',
    'atomicCounterIncrement',
    'atomicExchange',
    'atomicMax',
    'atomicMin',
    'atomicOr',
    'atomicXor',
    'barrier',
    'bitCount',
    'bitfieldExtract',
    'bitfieldInsert',
    'bitfieldReverse',
    'ceil',
    'clamp',
    'cos',
    'cosh',
    'cross',
    'degrees',
    'determinant',
    'dFdx',
    'dFdxCoarse',
    'dFdxFine',
    'dFdy',
    'dFdyCoarse',
    'dFdyFine',
    'distance',
    'dot',
    'EmitStreamVertex',
    'EmitVertex',
    'EndPrimitive',
    'EndStreamPrimitive',
    'equal',
    'exp',
    'exp2',
    'faceforward',
    'findLSB',
    'findMSB',
    'floatBitsToInt',
    'floatBitsToUint',
    'floor',
    'fma',
    'fract',
    'frexp',
    'fwidth',
    'fwidthCoarse',
    'fwidthFine',
    'greaterThan',
    'greaterThanEqual',
    'groupMemoryBarrier',
    'imageAtomicAdd',
    'imageAtomicAnd',
    'imageAtomicCompSwap',
    'imageAtomicExchange',
    'imageAtomicMax',
    'imageAtomicMin',
    'imageAtomicOr',
    'imageAtomicXor',
    'imageLoad',
    'imageSamples',
    'imageSize',
    'imageStore',
    'imulExtended',
    'intBitsToFloat',
    'interpolateAtCentroid',
    'interpolateAtOffset',
    'interpolateAtSample',
    'inverse',
    'inversesqrt',
    'isinf',
    'isnan',
    'ldexp',
    'length',
    'lessThan',
    'lessThanEqual',
    'log',
    'log2',
    'matrixCompMult',
    'max',
    'memoryBarrier',
    'memoryBarrierAtomicCounter',
    'memoryBarrierBuffer',
    'memoryBarrierImage',
    'memoryBarrierShared',
    'min',
    'mix',
    'mod',
    'modf',
    'noise',
    'noise1',
    'noise2',
    'noise3',
    'noise4',
    'normalize',
    'not',
    'notEqual',
    'outerProduct',
    'packDouble2x32',
    'packHalf2x16',
    'packSnorm2x16',
    'packSnorm4x8',
    'packUnorm',
    'packUnorm2x16',
    'packUnorm4x8',
    'pow',
    'radians',
    'reflect',
    'refract',
    'round',
    'roundEven',
    'sign',
    'sin',
    'sinh',
    'smoothstep',
    'sqrt',
    'step',
    'tan',
    'tanh',
    'texelFetch',
    'texelFetchOffset',
    'texture',
    'textureGather',
    'textureGatherOffset',
    'textureGatherOffsets',
    'textureGrad',
    'textureGradOffset',
    'textureLod',
    'textureLodOffset',
    'textureOffset',
    'textureProj',
    'textureProjGrad',
    'textureProjGradOffset',
    'textureProjLod',
    'textureProjLodOffset',
    'textureProjOffset',
    'textureQueryLevels',
    'textureQueryLod',
    'textureSamples',
    'textureSize',
    'transpose',
    'trunc',
    'uaddCarry',
    'uintBitsToFloat',
    'umulExtended',
    'unpackDouble2x32',
    'unpackHalf2x16',
    'unpackSnorm2x16',
    'unpackSnorm4x8',
    'unpackUnorm',
    'unpackUnorm2x16',
    'unpackUnorm4x8',
    'usubBorrow',
    // GLSL ES 1.00
    'texture2D',
    'textureCube',
]);
/**
 * Uses a closure to provide Peggyjs-parser-execution-aware context
 */
export var makeLocals = function (context) {
    var getLocation = function (loc) {
        // Try to avoid calling getLocation() more than neccessary
        if (!context.options.includeLocation) {
            return;
        }
        // Intentionally drop the "source" and "offset" keys from the location object
        var _a = loc || context.location(), start = _a.start, end = _a.end;
        return { start: start, end: end };
    };
    // getLocation() (and etc. functions) are not available in global scope,
    // so node() is moved to per-parse scope
    var node = function (type, attrs) {
        var n = __assign({ type: type }, attrs);
        if (context.options.includeLocation) {
            n.location = getLocation();
        }
        return n;
    };
    var makeScope = function (name, parent, startLocation) {
        var newLocation = getLocation(startLocation);
        return __assign(__assign({ name: name, parent: parent }, (newLocation ? { location: newLocation } : false)), { bindings: {}, types: {}, functions: {} });
    };
    var warn = function (message) {
        if (context.options.failOnWarn) {
            throw new Error(message);
        }
        if (!context.options.quiet) {
            console.warn(message);
        }
    };
    var pushScope = function (scope) {
        context.scopes.push(scope);
        return scope;
    };
    var popScope = function (scope) {
        if (!scope.parent) {
            throw new Error("Popped bad scope ".concat(scope, " at ").concat(context.text()));
        }
        return scope.parent;
    };
    var setScopeEnd = function (scope, end) {
        if (context.options.includeLocation) {
            if (!scope.location) {
                console.error("No end location at ".concat(context.text()));
            }
            else {
                scope.location.end = end;
            }
        }
    };
    /**
     * Use this when you encounter a function call. warns() if the function is
     * not defined or doesn't have a known overload. See the "Caution" note in the
     * README for the false positive in findOverloadDefinition()
     */
    var addFunctionCallReference = function (scope, name, fnRef) {
        var _a;
        var global = findGlobalScope(scope);
        var signature = functionUseSignature(fnRef);
        if (!global.functions[name]) {
            warn("Encountered undeclared function: \"".concat(name, "\" with signature \"").concat(signature[2], "\""));
            global.functions[name] = (_a = {},
                _a[signature[2]] = newOverloadIndex(signature[0], signature[1], fnRef),
                _a);
        }
        else {
            var existingOverload = findOverloadDefinition(signature, global.functions[name]);
            if (!existingOverload) {
                warn("No matching overload for function: \"".concat(name, "\" with signature \"").concat(signature[2], "\""));
                global.functions[name][signature[2]] = newOverloadIndex(signature[0], signature[1], fnRef);
            }
            else {
                existingOverload.references.push(fnRef);
            }
        }
    };
    /**
     * Create a definition for a function in the global scope. Use this when you
     * encounter a function definition.
     */
    var createFunctionDefinition = function (scope, name, fnRef) {
        var global = findGlobalScope(scope);
        var signature = functionDeclarationSignature(fnRef);
        if (!global.functions[name]) {
            global.functions[name] = {};
        }
        var existing = global.functions[name][signature[2]];
        if (existing) {
            if (existing.declaration) {
                warn("Encountered duplicate function definition: \"".concat(name, "\" with signature \"").concat(signature[2], "\""));
            }
            else {
                existing.declaration = fnRef;
            }
            existing.references.push(fnRef);
        }
        else {
            global.functions[name][signature[2]] = newOverloadIndex(signature[0], signature[1], fnRef);
            global.functions[name][signature[2]].declaration = fnRef;
        }
    };
    /**
     * Create a definition for a function prototype. This is *not* the function
     * declaration in scope.
     */
    var createFunctionPrototype = function (scope, name, fnRef) {
        var global = findGlobalScope(scope);
        var signature = functionDeclarationSignature(fnRef);
        if (!global.functions[name]) {
            global.functions[name] = {};
        }
        var existing = global.functions[name][signature[2]];
        if (existing) {
            warn("Encountered duplicate function prototype: \"".concat(name, "\" with signature \"").concat(signature[2], "\""));
            existing.references.push(fnRef);
        }
        else {
            global.functions[name][signature[2]] = newOverloadIndex(signature[0], signature[1], fnRef);
        }
    };
    /**
     * Add the use of a struct TYPE_NAME to the scope. Use this when you know
     * you've encountered a struct name.
     */
    var addTypeReference = function (scope, name, reference) {
        var declaredScope = findTypeScope(scope, name);
        if (declaredScope) {
            declaredScope.types[name].references.push(reference);
        }
        else {
            warn("Encountered undeclared type: \"".concat(name, "\""));
            scope.types[name] = {
                references: [reference],
            };
        }
    };
    /**
     * Create a new user defined type (struct) scope entry. Use this only when you
     * know this is a valid struct definition. If the struct name is already
     * defined, warn()
     */
    var createType = function (scope, name, declaration) {
        if (name in scope.types) {
            if (scope.types[name].declaration) {
                warn("Encountered duplicate type declaration: \"".concat(name, "\""));
            }
            else {
                warn("Type \"".concat(name, "\" was used before it was declared"));
                scope.types[name].declaration = declaration;
            }
            scope.types[name].references.push(declaration);
        }
        else {
            scope.types[name] = {
                declaration: declaration,
                references: [declaration],
            };
        }
    };
    /**
     * Given a TypeSpecifier, check if it includes a TYPE_NAME node, and if so,
     * track it in scope. Use this on any TypeSpecifier.
     */
    var addTypeIfFound = function (scope, node) {
        var _a;
        var specifier = node.type === 'fully_specified_type'
            ? (_a = node === null || node === void 0 ? void 0 : node.specifier) === null || _a === void 0 ? void 0 : _a.specifier
            : node === null || node === void 0 ? void 0 : node.specifier;
        if (specifier.type === 'type_name') {
            var name = specifier.identifier;
            addTypeReference(scope, name, specifier);
            // If type is 'struct', then it was declared in struct_specifier. If
        }
        else if (specifier.type !== 'struct' && specifier.type !== 'keyword') {
            console.warn('Unknown specifier', specifier);
            throw new Error("Unknown declarator specifier ".concat(specifier === null || specifier === void 0 ? void 0 : specifier.type, ". Please file a bug against @shaderfrog/glsl-parser and incldue your source grammar."));
        }
    };
    /**
     * Create new variable declarations in the scope. Only use this when you know
     * the variable is being defined by the AstNode in question.
     */
    var createBindings = function (scope) {
        var bindings = [];
        for (var _i = 1; _i < arguments.length; _i++) {
            bindings[_i - 1] = arguments[_i];
        }
        bindings.forEach(function (_a) {
            var identifier = _a[0], binding = _a[1];
            var existing = scope.bindings[identifier];
            if (existing) {
                warn("Encountered duplicate variable declaration: \"".concat(identifier, "\""));
                existing.references.unshift(binding);
            }
            else {
                scope.bindings[identifier] = makeScopeIndex(binding, binding);
            }
        });
    };
    /**
     * When a variable name is encountered in the AST, either add it to the scope
     * it's defined in, or if it's not defined, warn(), and add a scope entry
     * without a declaraiton.
     * Used in the parse tree when you don't know if a variable should be defined
     * yet or not, like encountering an IDENTIFIER in an expression.
     */
    var addOrCreateBindingReference = function (scope, name, reference) {
        // In the case of "float definition = 1, b = definition;" we parse the final "definition" before the
        // parent declarator list is parsed. So we might need to add the final "definition"
        // to the scope first.
        var foundScope = findBindingScope(scope, name);
        if (foundScope) {
            foundScope.bindings[name].references.push(reference);
        }
        else {
            if (!context.options.stage ||
                (context.options.stage === 'vertex' && !BUILT_INS.vertex.has(name)) ||
                (context.options.stage === 'fragment' &&
                    !BUILT_INS.fragment.has(name)) ||
                (context.options.stage === 'either' &&
                    !BUILT_INS.vertex.has(name) &&
                    !BUILT_INS.fragment)) {
                warn("Encountered undefined variable: \"".concat(name, "\""));
            }
            // This intentionally does not provide a declaration
            scope.bindings[name] = makeScopeIndex(reference);
        }
    };
    // Group the statements in a switch statement into cases / default arrays
    var groupCases = function (statements) {
        return statements.reduce(function (cases, stmt) {
            var partial = 'partial' in stmt ? stmt.partial : {};
            if (partial.type === 'case_label') {
                return __spreadArray(__spreadArray([], cases, true), [
                    node('switch_case', {
                        statements: [],
                        case: partial.case,
                        test: partial.test,
                        colon: partial.colon,
                    }),
                ], false);
            }
            else if (partial.type === 'default_label') {
                return __spreadArray(__spreadArray([], cases, true), [
                    node('default_case', {
                        statements: [],
                        default: partial.default,
                        colon: partial.colon,
                    }),
                ], false);
                // It would be nice to encode this in the grammar instead of a manual check
            }
            else if (!cases.length) {
                throw new Error('A switch statement body must start with a case or default label');
            }
            else {
                // While converting this file to Typescript, I don't remember what this
                // else case is covering
                var tail = cases.slice(-1)[0];
                return __spreadArray(__spreadArray([], cases.slice(0, -1), true), [
                    __assign(__assign({}, tail), { statements: __spreadArray(__spreadArray([], tail.statements, true), [stmt], false) }),
                ], false);
            }
        }, []);
    };
    context.scope = makeScope('global');
    context.scopes = [context.scope];
    return {
        getLocation: getLocation,
        node: node,
        makeScope: makeScope,
        warn: warn,
        pushScope: pushScope,
        popScope: popScope,
        setScopeEnd: setScopeEnd,
        createFunctionDefinition: createFunctionDefinition,
        addFunctionCallReference: addFunctionCallReference,
        createFunctionPrototype: createFunctionPrototype,
        groupCases: groupCases,
        addTypeReference: addTypeReference,
        addTypeIfFound: addTypeIfFound,
        createType: createType,
        createBindings: createBindings,
        addOrCreateBindingReference: addOrCreateBindingReference,
    };
};
