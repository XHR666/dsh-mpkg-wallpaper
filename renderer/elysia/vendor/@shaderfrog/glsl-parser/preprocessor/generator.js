import { makeGenerator } from '../ast/index.js';
/**
 * Stringify an AST
 */
// @ts-ignore
var makeGeneratorPreprocessor = makeGenerator;
var generators = {
    program: function (node) { return generate(node.program) + generate(node.wsEnd); },
    segment: function (node) { return generate(node.blocks); },
    text: function (node) { return generate(node.text); },
    literal: function (node) {
        return generate(node.wsStart) + generate(node.literal) + generate(node.wsEnd);
    },
    identifier: function (node) { return generate(node.identifier) + generate(node.wsEnd); },
    binary: function (node) {
        return generate(node.left) + generate(node.operator) + generate(node.right);
    },
    group: function (node) {
        return generate(node.lp) + generate(node.expression) + generate(node.rp);
    },
    unary: function (node) { return generate(node.operator) + generate(node.expression); },
    unary_defined: function (node) {
        return generate(node.operator) +
            generate(node.lp) +
            generate(node.identifier) +
            generate(node.rp);
    },
    int_constant: function (node) { return generate(node.token) + generate(node.wsEnd); },
    elseif: function (node) {
        return generate(node.token) +
            generate(node.expression) +
            generate(node.wsEnd) +
            generate(node.body);
    },
    if: function (node) {
        return generate(node.token) +
            generate(node.expression) +
            generate(node.wsEnd) +
            generate(node.body);
    },
    ifdef: function (node) {
        return generate(node.token) +
            generate(node.identifier) +
            generate(node.wsEnd) +
            generate(node.body);
    },
    ifndef: function (node) {
        return generate(node.token) +
            generate(node.identifier) +
            generate(node.wsEnd) +
            generate(node.body);
    },
    else: function (node) {
        return generate(node.token) + generate(node.wsEnd) + generate(node.body);
    },
    error: function (node) {
        return generate(node.error) + generate(node.message) + generate(node.wsEnd);
    },
    undef: function (node) {
        return generate(node.undef) + generate(node.identifier) + generate(node.wsEnd);
    },
    define: function (node) {
        return generate(node.wsStart) +
            generate(node.define) +
            generate(node.identifier) +
            generate(node.body) +
            generate(node.wsEnd);
    },
    define_arguments: function (node) {
        return generate(node.wsStart) +
            generate(node.define) +
            generate(node.identifier) +
            generate(node.lp) +
            generate(node.args) +
            generate(node.rp) +
            generate(node.body) +
            generate(node.wsEnd);
    },
    conditional: function (node) {
        return generate(node.wsStart) +
            generate(node.ifPart) +
            // generate(node.body) +
            generate(node.elseIfParts) +
            generate(node.elsePart) +
            generate(node.endif) +
            generate(node.wsEnd);
    },
    version: function (node) {
        return generate(node.version) +
            generate(node.value) +
            generate(node.profile) +
            generate(node.wsEnd);
    },
    pragma: function (node) {
        return generate(node.pragma) + generate(node.body) + generate(node.wsEnd);
    },
    line: function (node) {
        return generate(node.line) + generate(node.value) + generate(node.wsEnd);
    },
    extension: function (node) {
        return generate(node.extension) +
            generate(node.name) +
            generate(node.colon) +
            generate(node.behavior) +
            generate(node.wsEnd);
    },
};
var generate = makeGeneratorPreprocessor(generators);
export default generate;
