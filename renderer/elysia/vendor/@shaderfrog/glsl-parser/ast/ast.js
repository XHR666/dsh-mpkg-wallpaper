/**
 * Stringify an AST
 */
export var makeGenerator = function (generators) {
    var gen = function (ast) {
        return typeof ast === 'string'
            ? ast
            : ast === null || ast === undefined
                ? ''
                : Array.isArray(ast)
                    ? ast.map(gen).join('')
                    : ast.type in generators
                        ? generators[ast.type](ast)
                        : "NO GENERATOR FOR ".concat(ast.type) + ast;
    };
    return gen;
};
export var makeEveryOtherGenerator = function (generate) {
    var everyOther = function (nodes, eo) {
        return nodes.reduce(function (output, node, index) {
            return output +
                generate(node) +
                (index === nodes.length - 1 ? '' : generate(eo[index]));
        }, '');
    };
    return everyOther;
};
