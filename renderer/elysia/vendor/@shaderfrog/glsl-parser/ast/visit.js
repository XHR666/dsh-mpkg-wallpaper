var isNode = function (node) { return !!(node === null || node === void 0 ? void 0 : node.type); };
var isTraversable = function (node) { return isNode(node) || Array.isArray(node); };
var makePath = function (node, parent, parentPath, key, index) { return ({
    node: node,
    parent: parent,
    parentPath: parentPath,
    key: key,
    index: index,
    stop: function () {
        this.stopped = true;
    },
    skip: function () {
        this.skipped = true;
    },
    remove: function () {
        this.removed = true;
    },
    replaceWith: function (replacer) {
        this.replaced = replacer;
    },
    findParent: function (test) {
        return !parentPath
            ? parentPath
            : test(parentPath)
                ? parentPath
                : parentPath.findParent(test);
    },
}); };
/**
 * Apply the visitor pattern to an AST that conforms to this compiler's spec
 */
export var visit = function (ast, visitors) {
    var stopped = false;
    var visitNode = function (node, parent, parentPath, key, index) {
        var _a;
        // Handle case where stop happened at exit
        if (stopped) {
            return;
        }
        var visitor = visitors[node.type];
        var path = makePath(node, parent, parentPath, key, index);
        var parentNode = parent;
        if (visitor === null || visitor === void 0 ? void 0 : visitor.enter) {
            visitor.enter(path);
            if (path.removed) {
                if (!key || !parent) {
                    throw new Error("Asked to remove ".concat(node, " but no parent key was present in ").concat(parent));
                }
                if (typeof index === 'number') {
                    parentNode[key].splice(index, 1);
                }
                else {
                    parentNode[key] = null;
                }
                return path;
            }
            if (path.replaced) {
                if (!key || !parent) {
                    throw new Error("Asked to remove ".concat(node, " but no parent key was present in ").concat(parent));
                }
                if (typeof index === 'number') {
                    parentNode[key].splice(index, 1, path.replaced);
                }
                else {
                    parentNode[key] = path.replaced;
                }
            }
            if (path.skipped) {
                return path;
            }
        }
        if (path.stopped) {
            stopped = true;
            return;
        }
        if (path.replaced) {
            var replacedNode = path.replaced;
            visitNode(replacedNode, parent, parentPath, key, index);
        }
        else {
            Object.entries(node)
                .filter(function (_a) {
                var _ = _a[0], nodeValue = _a[1];
                return isTraversable(nodeValue);
            })
                .forEach(function (_a) {
                var nodeKey = _a[0], nodeValue = _a[1];
                if (Array.isArray(nodeValue)) {
                    for (var i = 0, offset = 0; i - offset < nodeValue.length && !stopped; i++) {
                        var child = nodeValue[i - offset];
                        var res = visitNode(child, node, path, nodeKey, i - offset);
                        if (res === null || res === void 0 ? void 0 : res.removed) {
                            offset += 1;
                        }
                    }
                }
                else {
                    if (!stopped) {
                        visitNode(nodeValue, node, path, nodeKey);
                    }
                }
            });
            if (!stopped) {
                (_a = visitor === null || visitor === void 0 ? void 0 : visitor.exit) === null || _a === void 0 ? void 0 : _a.call(visitor, path);
            }
        }
    };
    visitNode(ast);
};
