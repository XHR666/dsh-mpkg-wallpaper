import { makeGenerator, makeEveryOtherGenerator, } from '../ast/index.js';
var generators = {
    program: function (node) { return generate(node.wsStart) + generate(node.program); },
    preprocessor: function (node) { return generate(node.line) + generate(node._); },
    keyword: function (node) { return generate(node.token) + generate(node.whitespace); },
    precision: function (node) {
        return generate(node.prefix) + generate(node.qualifier) + generate(node.specifier);
    },
    // Statements
    expression_statement: function (node) {
        return generate(node.expression) + generate(node.semi);
    },
    if_statement: function (node) {
        return generate(node.if) +
            generate(node.lp) +
            generate(node.condition) +
            generate(node.rp) +
            generate(node.body) +
            generate(node.else);
    },
    switch_statement: function (node) {
        return generate(node.switch) +
            generate(node.lp) +
            generate(node.expression) +
            generate(node.rp) +
            generate(node.lb) +
            generate(node.cases) +
            generate(node.rb);
    },
    break_statement: function (node) { return generate(node.break) + generate(node.semi); },
    do_statement: function (node) {
        return generate(node.do) +
            generate(node.body) +
            generate(node.while) +
            generate(node.lp) +
            generate(node.expression) +
            generate(node.rp) +
            generate(node.semi);
    },
    continue_statement: function (node) { return generate(node.continue) + generate(node.semi); },
    return_statement: function (node) {
        return generate(node.return) + generate(node.expression) + generate(node.semi);
    },
    discard_statement: function (node) { return generate(node.discard) + generate(node.semi); },
    while_statement: function (node) {
        return generate(node.while) +
            generate(node.lp) +
            generate(node.condition) +
            generate(node.rp) +
            generate(node.body);
    },
    for_statement: function (node) {
        return generate(node.for) +
            generate(node.lp) +
            generate(node.init) +
            generate(node.initSemi) +
            generate(node.condition) +
            generate(node.conditionSemi) +
            generate(node.operation) +
            generate(node.rp) +
            generate(node.body);
    },
    condition_expression: function (node) {
        return generate(node.specified_type) +
            generate(node.identifier) +
            generate(node.operator) +
            generate(node.initializer);
    },
    declaration_statement: function (node) {
        return generate(node.declaration) + generate(node.semi);
    },
    fully_specified_type: function (node) {
        return generate(node.qualifiers) + generate(node.specifier);
    },
    layout_qualifier: function (node) {
        return generate(node.layout) +
            generate(node.lp) +
            generateWithEveryOther(node.qualifiers, node.commas) +
            generate(node.rp);
    },
    layout_qualifier_id: function (node) {
        return generate(node.identifier) +
            generate(node.operator) +
            generate(node.expression);
    },
    switch_case: function (node) {
        return generate(node.case) +
            generate(node.test) +
            generate(node.colon) +
            generate(node.statements);
    },
    default_case: function (node) {
        return generate(node.default) + generate(node.colon) + generate(node.statements);
    },
    declaration: function (node) {
        return generate(node.identifier) +
            generate(node.quantifier) +
            generate(node.equal) +
            generate(node.initializer);
    },
    declarator_list: function (node) {
        return generate(node.specified_type) +
            generateWithEveryOther(node.declarations, node.commas);
    },
    type_specifier: function (node) {
        return generate(node.specifier) + generate(node.quantifier);
    },
    array_specifier: function (node) {
        return generate(node.lb) + generate(node.expression) + generate(node.rb);
    },
    identifier: function (node) { return node.identifier + generate(node.whitespace); },
    type_name: function (node) { return node.identifier + generate(node.whitespace); },
    function_header: function (node) {
        return generate(node.returnType) + generate(node.name) + generate(node.lp);
    },
    function_prototype: function (node) {
        return generate(node.header.returnType) +
            generate(node.header.name) +
            generate(node.header.lp) +
            (node.parameters
                ? generateWithEveryOther(node.parameters, node.commas)
                : '') +
            generate(node.rp);
    },
    parameter_declaration: function (node) {
        return generate(node.qualifier) +
            generate(node.specifier) +
            generate(node.identifier) +
            generate(node.quantifier);
    },
    compound_statement: function (node) {
        return generate(node.lb) + generate(node.statements) + generate(node.rb);
    },
    function: function (node) { return generate(node['prototype']) + generate(node.body); },
    function_call: function (node) {
        return generate(node.identifier) +
            generate(node.lp) +
            generate(node.args) +
            generate(node.rp);
    },
    postfix: function (node) { return generate(node.expression) + generate(node.postfix); },
    quantifier: function (node) {
        return generate(node.lb) + generate(node.expression) + generate(node.rb);
    },
    quantified_identifier: function (node) {
        return generate(node.identifier) + generate(node.quantifier);
    },
    field_selection: function (node) { return generate(node.dot) + generate(node.selection); },
    subroutine_qualifier: function (node) {
        return generate(node.subroutine) +
            generate(node.lp) +
            generate(node.type_names) +
            generate(node.commas) +
            generate(node.rp);
    },
    assignment: function (node) {
        return generate(node.left) + generate(node.operator) + generate(node.right);
    },
    ternary: function (node) {
        return generate(node.expression) +
            generate(node.question) +
            generate(node.left) +
            generate(node.colon) +
            generate(node.right);
    },
    binary: function (node) {
        return generate(node.left) + generate(node.operator) + generate(node.right);
    },
    group: function (node) {
        return generate(node.lp) + generate(node.expression) + generate(node.rp);
    },
    unary: function (node) { return generate(node.operator) + generate(node.expression); },
    float_constant: function (node) { return generate(node.token) + generate(node.whitespace); },
    double_constant: function (node) { return generate(node.token) + generate(node.whitespace); },
    int_constant: function (node) { return generate(node.token) + generate(node.whitespace); },
    uint_constant: function (node) { return generate(node.token) + generate(node.whitespace); },
    bool_constant: function (node) { return generate(node.token) + generate(node.whitespace); },
    literal: function (node) { return generate(node.literal) + generate(node.whitespace); },
    struct: function (node) {
        return generate(node.struct) +
            generate(node.typeName) +
            generate(node.lb) +
            generate(node.declarations) +
            generate(node.rb);
    },
    struct_declaration: function (node) {
        return generate(node.declaration) + generate(node.semi);
    },
    interface_declarator: function (node) {
        return generate(node.qualifiers) +
            generate(node.interface_type) +
            generate(node.lp) +
            generate(node.declarations) +
            generate(node.rp) +
            generate(node.identifier);
    },
    struct_declarator: function (node) {
        return generate(node.specified_type) +
            generateWithEveryOther(node.declarations, node.commas);
    },
    initializer_list: function (node) {
        return generate(node.lb) +
            generateWithEveryOther(node.initializers, node.commas) +
            generate(node.rb);
    },
    qualifier_declarator: function (node) {
        return generate(node.qualifiers) +
            generateWithEveryOther(node.declarations, node.commas);
    },
};
var generate = makeGenerator(generators);
var generateWithEveryOther = makeEveryOtherGenerator(generate);
export default generate;
