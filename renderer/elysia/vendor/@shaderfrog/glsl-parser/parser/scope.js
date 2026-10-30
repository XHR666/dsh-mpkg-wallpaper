var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
import { xor } from './utils.js';
export var UNKNOWN_TYPE = 'UNKNOWN TYPE';
export var makeScopeIndex = function (firstReference, declaration) { return ({
    declaration: declaration,
    references: [firstReference],
}); };
export var findTypeScope = function (scope, typeName) {
    if (!scope) {
        return null;
    }
    if (typeName in scope.types) {
        return scope;
    }
    return findTypeScope(scope.parent, typeName);
};
export var isDeclaredType = function (scope, typeName) {
    return findTypeScope(scope, typeName) !== null;
};
export var findBindingScope = function (scope, name) {
    if (!scope) {
        return null;
    }
    if (name in scope.bindings) {
        return scope;
    }
    return findBindingScope(scope.parent, name);
};
export var extractConstant = function (expression) {
    var result = UNKNOWN_TYPE;
    // Keyword case, like float
    if ('token' in expression) {
        result = expression.token;
        // User defined type
    }
    else if ('identifier' in expression &&
        typeof expression.identifier === 'string') {
        result = expression.identifier;
    }
    else {
        console.warn(result, expression);
    }
    return result;
};
export var quantifiersSignature = function (quantifier) {
    return quantifier.map(function (q) { return "[".concat(extractConstant(q.expression), "]"); }).join('');
};
export var functionDeclarationSignature = function (node) {
    var _a;
    var proto = node.type === 'function' ? node.prototype : node;
    var specifier = proto.header.returnType.specifier;
    var quantifiers = specifier.quantifier || [];
    var parameterTypes = ((_a = proto === null || proto === void 0 ? void 0 : proto.parameters) === null || _a === void 0 ? void 0 : _a.map(function (_a) {
        var specifier = _a.specifier, quantifier = _a.quantifier;
        var quantifiers = 
        // vec4[1][2] param
        specifier.quantifier ||
            // vec4 param[1][3]
            quantifier ||
            [];
        return "".concat(extractConstant(specifier.specifier)).concat(quantifiersSignature(quantifiers));
    })) || ['void'];
    var returnType = "".concat(specifier.specifier.token).concat(quantifiersSignature(quantifiers));
    return [
        returnType,
        parameterTypes,
        "".concat(returnType, ": ").concat(parameterTypes.join(', ')),
    ];
};
export var doSignaturesMatch = function (definitionSignature, definition, callSignature) {
    if (definitionSignature === callSignature[0]) {
        return true;
    }
    var left = __spreadArray([definition.returnType], definition.parameterTypes, true);
    var right = __spreadArray([callSignature[0]], callSignature[1], true);
    // Special case. When comparing "a()" to "a(1)", a() has paramater VOID, and
    // a(1) has type UNKNOWN. This will pass as true in the final check of this
    // function, even though it's not.
    if (left.length === 2 && xor(left[1] === 'void', right[1] === 'void')) {
        return false;
    }
    return (left.length === right.length &&
        left.every(function (type, index) {
            return type === right[index] ||
                type === UNKNOWN_TYPE ||
                right[index] === UNKNOWN_TYPE;
        }));
};
export var findOverloadDefinition = function (signature, index) {
    return Object.entries(index).reduce(function (found, _a) {
        var overloadSignature = _a[0], overloadDefinition = _a[1];
        return (found ||
            (doSignaturesMatch(overloadSignature, overloadDefinition, signature)
                ? overloadDefinition
                : undefined));
    }, undefined);
};
export var functionUseSignature = function (node) {
    var parameterTypes = node.args.length === 0
        ? ['void']
        : node.args
            .filter(function (arg) { return arg.literal !== ','; })
            .map(function () { return UNKNOWN_TYPE; });
    var returnType = UNKNOWN_TYPE;
    return [
        returnType,
        parameterTypes,
        "".concat(returnType, ": ").concat(parameterTypes.join(', ')),
    ];
};
export var newOverloadIndex = function (returnType, parameterTypes, firstReference, declaration) { return ({
    returnType: returnType,
    parameterTypes: parameterTypes,
    declaration: declaration,
    references: [firstReference],
}); };
export var findGlobalScope = function (scope) {
    return scope.parent ? findGlobalScope(scope.parent) : scope;
};
export var isDeclaredFunction = function (scope, fnName) {
    return fnName in findGlobalScope(scope).functions;
};
