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
export var renameBinding = function (binding, newName) {
    binding.references.forEach(function (node) {
        if (node.type === 'declaration') {
            node.identifier.identifier = newName;
        }
        else if (node.type === 'identifier') {
            node.identifier = newName;
        }
        else if (node.type === 'parameter_declaration' && node.identifier) {
            node.identifier.identifier = newName;
            /* Ignore case of:
              layout(std140,column_major) uniform;
              uniform Material {
                uniform vec2 prop;
              }
            */
        }
        else if (node.type !== 'interface_declarator') {
            console.warn('Unknown binding node', node);
            throw new Error("Binding for type ".concat(node.type, " not recognized"));
        }
    });
    return binding;
};
export var renameBindings = function (bindings, mangle) {
    return Object.entries(bindings).reduce(function (acc, _a) {
        var _b;
        var name = _a[0], binding = _a[1];
        var mangled = mangle(name);
        return __assign(__assign({}, acc), (_b = {}, _b[mangled] = renameBinding(binding, mangled), _b));
    }, {});
};
export var renameType = function (type, newName) {
    type.references.forEach(function (node) {
        if (node.type === 'type_name') {
            node.identifier = newName;
        }
        else {
            console.warn('Unknown type node', node);
            throw new Error("Type ".concat(node.type, " not recognized"));
        }
    });
    return type;
};
export var renameTypes = function (types, mangle) {
    return Object.entries(types).reduce(function (acc, _a) {
        var _b;
        var name = _a[0], type = _a[1];
        var mangled = mangle(name);
        return __assign(__assign({}, acc), (_b = {}, _b[mangled] = renameType(type, mangled), _b));
    }, {});
};
export var renameFunction = function (overloadIndex, newName) {
    Object.entries(overloadIndex).forEach(function (_a) {
        var signature = _a[0], overload = _a[1];
        overload.references.forEach(function (node) {
            if (node.type === 'function') {
                node['prototype'].header.name.identifier = newName;
            }
            else if (node.type === 'function_call' &&
                node.identifier.type === 'postfix') {
                // @ts-ignore
                var specifier = node.identifier.expression.identifier.specifier;
                if (specifier) {
                    specifier.identifier = newName;
                }
                else {
                    console.warn('Unknown function node to rename', node);
                    throw new Error("Function specifier type ".concat(node.type, " not recognized"));
                }
            }
            else if (node.type === 'function_call' &&
                'specifier' in node.identifier &&
                'identifier' in node.identifier.specifier) {
                node.identifier.specifier.identifier = newName;
            }
            else if (node.type === 'function_call' &&
                node.identifier.type === 'identifier') {
                node.identifier.identifier = newName;
            }
            else if (node.type === 'function_prototype') {
                node.header.name.identifier = newName;
            }
            else {
                console.warn('Unknown function node to rename', node);
                throw new Error("Function for type ".concat(node.type, " not recognized"));
            }
        });
    });
    return overloadIndex;
};
export var renameFunctions = function (functions, mangle) {
    return Object.entries(functions).reduce(function (acc, _a) {
        var _b;
        var fnName = _a[0], overloads = _a[1];
        var mangled = mangle(fnName);
        return __assign(__assign({}, acc), (_b = {}, _b[mangled] = renameFunction(overloads, mangled), _b));
    }, {});
};
export var xor = function (a, b) { return (a || b) && !(a && b); };
export var debugEntry = function (bindings) {
    return Object.entries(bindings).map(function (_a) {
        var k = _a[0], v = _a[1];
        return "".concat(k, ": (").concat(v.references.length, " references, ").concat(v.declaration ? '' : 'un', "declared): ").concat(v.references.map(function (r) { return r.type; }).join(', '));
    });
};
export var debugFunctionEntry = function (bindings) {
    return Object.entries(bindings).flatMap(function (_a) {
        var name = _a[0], overloads = _a[1];
        return Object.entries(overloads).map(function (_a) {
            var signature = _a[0], overload = _a[1];
            return "".concat(name, " (").concat(signature, "): (").concat(overload.references.length, " references, ").concat(overload.declaration ? '' : 'un', "declared): ").concat(overload.references.map(function (r) { return r.type; }).join(', '));
        });
    });
};
export var debugScopes = function (astOrScopes) {
    return console.log('Scopes:', 'scopes' in astOrScopes
        ? astOrScopes.scopes
        : astOrScopes.map(function (s) { return ({
            name: s.name,
            types: debugEntry(s.types),
            bindings: debugEntry(s.bindings),
            functions: debugFunctionEntry(s.functions),
        }); }));
};
