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
import { visit } from '../ast/visit.js';
import * as parser from './preprocessor-parser.js';
import { formatError } from '../error.js';
var without = function (obj) {
    var keys = [];
    for (var _i = 1; _i < arguments.length; _i++) {
        keys[_i - 1] = arguments[_i];
    }
    return Object.entries(obj).reduce(function (acc, _a) {
        var _b;
        var key = _a[0], value = _a[1];
        return (__assign(__assign({}, acc), (!keys.includes(key) && (_b = {}, _b[key] = value, _b))));
    }, {});
};
// Scan for the use of a function-like macro, balancing parentheses until
// encountering a final closing ")" marking the end of the macro use
var scanFunctionArgs = function (src) {
    var char;
    var parens = 0;
    var args = [];
    var arg = '';
    for (var i = 0; i < src.length; i++) {
        char = src.charAt(i);
        if (char === '(') {
            parens++;
        }
        if (char === ')') {
            parens--;
        }
        if (parens === -1) {
            // In the case of "()", we don't want to add the argument of empty string,
            // but we do in case of "(,)" and "(asdf)". When we hit the closing paren,
            // only capture the arg of empty string if there was a previous comma,
            // which we can infer from there being a previous arg
            if (arg !== '' || args.length) {
                args.push(arg);
            }
            return { args: args, length: i };
        }
        if (char === ',' && parens === 0) {
            args.push(arg);
            arg = '';
        }
        else {
            arg += char;
        }
    }
    return null;
};
// From glsl2s https://github.com/cimaron/glsl2js/blob/4046611ac4f129a9985d74704159c41a402564d0/preprocessor/comments.js
var preprocessComments = function (src) {
    var i;
    var chr;
    var la;
    var out = '';
    var line = 1;
    var in_single = 0;
    var in_multi = 0;
    for (i = 0; i < src.length; i++) {
        chr = src.substring(i, i + 1);
        la = src.substring(i + 1, i + 2);
        // Enter single line comment
        if (chr == '/' && la == '/' && !in_single && !in_multi) {
            in_single = line;
            i++;
            continue;
        }
        // Exit single line comment
        if (chr == '\n' && in_single) {
            in_single = 0;
        }
        // Enter multi line comment
        if (chr == '/' && la == '*' && !in_multi && !in_single) {
            in_multi = line;
            i++;
            continue;
        }
        // Exit multi line comment
        if (chr == '*' && la == '/' && in_multi) {
            // Treat single line multi-comment as space
            if (in_multi == line) {
                out += ' ';
            }
            in_multi = 0;
            i++;
            continue;
        }
        // Newlines are preserved
        if ((!in_multi && !in_single) || chr == '\n') {
            out += chr;
            line++;
        }
    }
    return out;
};
var tokenPaste = function (str) { return str.replace(/\s+##\s+/g, ''); };
// Use the same parser, but starting from the expression entry point, to parse
// expression strings on the fly after macro expansion
var expressionParser = function (src) {
    return formatError(parser)(src, {
        grammarSource: 'expression',
        startRule: 'constant_expression',
    });
};
var evaluate = function (ast, evaluators) {
    var visit = function (node) {
        var evaluator = evaluators[node.type];
        if (!evaluator) {
            throw new Error("No evaluate() evaluator for ".concat(node.type));
        }
        // I can't figure out why evalutor has node type never here
        // @ts-ignore
        return evaluator(node, visit);
    };
    return visit(ast);
};
var expandFunctionMacro = function (macros, macroName, macro, text) {
    var pattern = "\\b".concat(macroName, "\\s*\\(");
    var startRegex = new RegExp(pattern, 'm');
    var expanded = '';
    var current = text;
    var startMatch;
    var _loop_1 = function () {
        var result = scanFunctionArgs(current.substring(startMatch.index + startMatch[0].length));
        if (result === null) {
            throw new Error("".concat(current.match(startRegex), " unterminated macro invocation"));
        }
        var macroArgs = (macro.args || []).filter(function (arg) { return arg.literal !== ','; });
        var args = result.args, argLength = result.length;
        // The total length of the raw text to replace is the macro name in the
        // text (startMatch), plus the length of the arguments, plus one to
        // encompass the closing paren that the scan fn skips
        var matchLength = startMatch[0].length + argLength + 1;
        if (args.length > macroArgs.length) {
            throw new Error("'".concat(macroName, "': Too many arguments for macro"));
        }
        if (args.length < macroArgs.length) {
            throw new Error("'".concat(macroName, "': Not enough arguments for macro"));
        }
        // Collect the macro identifiers and build a replacement map from those to
        // the user defined replacements
        var argIdentifiers = macroArgs.map(function (a) { return a.identifier; });
        var argKeys = argIdentifiers.reduce(function (acc, identifier, index) {
            var _a;
            return (__assign(__assign({}, acc), (_a = {}, _a[identifier] = expandMacros(args[index].trim(), macros), _a)));
        }, {});
        var replacedBody = tokenPaste(macro.body.replace(
        // Replace all instances of macro arguments in the macro definition
        // (the arg separated by word boundaries) with its user defined
        // replacement. This one-pass strategy ensures that we won't clobber
        // previous replacements when the user supplied args have the same names
        // as the macro arguments
        new RegExp('(' + argIdentifiers.map(function (a) { return "\\b".concat(a, "\\b"); }).join("|") + ')', 'g'), function (match) { return (match in argKeys ? argKeys[match] : match); }));
        // Any text expanded is then scanned again for more replacements. The
        // self-reference rule means that a macro that references itself won't be
        // expanded again, so remove it from the search. WARNING! There is a known
        // bug here! See the xtest in preprocessor.test.ts.
        var expandedReplace = expandMacros(replacedBody, without(macros, macroName));
        // We want to break this string at where we finished expanding the macro
        var endOfReplace = startMatch.index + expandedReplace.length;
        // Replace the use of the macro with the expansion
        var processed = current.replace(current.substring(startMatch.index, startMatch.index + matchLength), expandedReplace);
        // Add text up to the end of the expanded macro to what we've procssed
        expanded += processed.substring(0, endOfReplace);
        // Only work on the rest of the text, not what we already expanded. This is
        // to avoid a nested macro #define foo() foo() where we'll try to expand foo
        // forever. With this strategy, we expand foo() to foo() and move on
        current = processed.substring(endOfReplace);
    };
    while ((startMatch = startRegex.exec(current))) {
        _loop_1();
    }
    return expanded + current;
};
var expandObjectMacro = function (macros, macroName, macro, text) {
    var regex = new RegExp("\\b".concat(macroName, "\\b"), 'g');
    var expanded = text;
    if (regex.test(text)) {
        // Macro definitions like
        //     #define MACRO
        // Have null for the body. Make it empty string if null to avoid 'null' expanded
        var replacement = macro.body || '';
        // Recursively scan this macro body for more replacements, ignoring our own
        // macro to avoid the self-reference rule.
        var scanned = expandMacros(replacement, without(macros, macroName));
        expanded = tokenPaste(text.replace(new RegExp("\\b".concat(macroName, "\\b"), 'g'), scanned));
    }
    return expanded;
};
var expandMacros = function (text, macros) {
    return Object.entries(macros).reduce(function (result, _a) {
        var macroName = _a[0], macro = _a[1];
        return macro.args
            ? expandFunctionMacro(macros, macroName, macro, result)
            : expandObjectMacro(macros, macroName, macro, result);
    }, text);
};
var isTruthy = function (x) { return !!x; };
var evaluateIfPart = function (macros, ifPart) {
    if (ifPart.type === 'if') {
        return ifPart.expression
            ? isTruthy(evaluateExpressionString(ifPart.expression, macros))
            : false;
    }
    else if (ifPart.type === 'ifdef') {
        return ifPart.identifier.identifier in macros;
    }
    else if (ifPart.type === 'ifndef') {
        return !(ifPart.identifier.identifier in macros);
    }
};
// TODO: Are all of these operators equivalent between javascript and GLSL?
var evaluteExpression = function (node, macros) {
    return evaluate(node, {
        // TODO: Handle non-base-10 numbers. Should these be parsed in the peg grammar?
        int_constant: function (node) { return parseInt(node.token, 10); },
        unary_defined: function (node) { return node.identifier.identifier in macros; },
        identifier: function (node) { return 0; }, // Undefined macros evaluate to 0 per spec
        group: function (node, visit) { return visit(node.expression); },
        binary: function (_a, visit) {
            var left = _a.left, right = _a.right, literal = _a.operator.literal;
            switch (literal) {
                // multiplicative
                case '*': {
                    return visit(left) * visit(right);
                }
                // division
                case '/': {
                    return visit(left) / visit(right);
                }
                // modulo
                case '%': {
                    return visit(left) % visit(right);
                }
                // addition
                case '+': {
                    return visit(left) + visit(right);
                }
                // subtraction
                case '-': {
                    return visit(left) - visit(right);
                }
                // bit-wise shift
                case '<<': {
                    return visit(left) << visit(right);
                }
                // bit-wise shift
                case '>>': {
                    return visit(left) >> visit(right);
                }
                case '<': {
                    return visit(left) < visit(right);
                }
                case '>': {
                    return visit(left) > visit(right);
                }
                case '<=': {
                    return visit(left) <= visit(right);
                }
                case '>=': {
                    return visit(left) >= visit(right);
                }
                case '==': {
                    return visit(left) == visit(right);
                }
                case '!=': {
                    return visit(left) != visit(right);
                }
                // bit-wise and
                case '&': {
                    return visit(left) & visit(right);
                }
                // bit-wise exclusive or
                case '^': {
                    return visit(left) ^ visit(right);
                }
                // bit-wise inclusive or
                case '|': {
                    return visit(left) | visit(right);
                }
                case '&&': {
                    return visit(left) && visit(right);
                }
                case '||': {
                    return visit(left) || visit(right);
                }
                default: {
                    throw new Error("Preprocessing error: Unknown binary operator ".concat(literal));
                }
            }
        },
        unary: function (node, visit) {
            switch (node.operator.literal) {
                case '+': {
                    return visit(node.expression);
                }
                case '-': {
                    return -1 * visit(node.expression);
                }
                case '!': {
                    return !visit(node.expression);
                }
                case '~': {
                    return ~visit(node.expression);
                }
                default: {
                    throw new Error("Preprocessing error: Unknown unary operator ".concat(node.operator.literal));
                }
            }
        },
    });
};
var shouldPreserve = function (preserve) {
    if (preserve === void 0) { preserve = {}; }
    return function (path) {
        var test = preserve === null || preserve === void 0 ? void 0 : preserve[path.node.type];
        return typeof test === 'function' ? test(path) : test;
    };
};
// @ts-ignore
export var visitPreprocessedAst = visit;
var convertPath = function (p) {
    return p;
};
// Expressions are stored as strings in the AST, since their contents may be
// affected by macro expansion. This function performs macro expansion, then
// parses and evaluates the expanded string. It uses the same grammar, but
// starting from the "constant expression" rule to parse, aka the rule for the
// expression of an if / elif
var evaluateExpressionString = function (expr, macros) {
    // Strip inline comments so "defined/**/A" is treated as "defined A"
    var stripped = preprocessComments(expr);
    // In the input
    //     #define A
    //     #if !defined(A)
    // If we expand macros then evaluate the expression it will break. The spec
    // says that identifiers inside defined() are not eligible for expansion. So
    // hacky way to evaluate them first before macro expansion and parsing
    var defined = stripped
        .replace(/defined\s*\(\s*([A-Za-z_][A-Za-z_0-9]*)\s*\)/g, function (_, id) {
        return id in macros ? '1' : '0';
    })
        .replace(/defined\s+([A-Za-z_][A-Za-z_0-9]*)/g, function (_, id) {
        return id in macros ? '1' : '0';
    });
    var expanded = expandMacros(defined, macros);
    return evaluteExpression(expressionParser(expanded.trim()), macros);
};
// Remove escaped newlines, rather than try to handle them in the grammar
var unescapeSrc = function (src, options) {
    if (options === void 0) { options = {}; }
    return src.replace(/\\[\n\r]/g, '');
};
var preprocessAst = function (program, options) {
    if (options === void 0) { options = {}; }
    var macros = Object.entries(options.defines || {}).reduce(function (defines, _a) {
        var _b;
        var name = _a[0], body = _a[1];
        return (__assign(__assign({}, defines), (_b = {}, _b[name] = { body: body }, _b)));
    }, {});
    var preserve = options.preserve;
    var preserveNode = shouldPreserve(preserve);
    visitPreprocessedAst(program, {
        conditional: {
            enter: function (initialPath) {
                var path = convertPath(initialPath);
                var node = path.node;
                // TODO: Determining if we need to handle edge case conditionals here
                if (preserveNode(path)) {
                    return;
                }
                if (evaluateIfPart(macros, node.ifPart)) {
                    path.replaceWith(node.ifPart.body);
                }
                else {
                    var elseBranchHit = node.elseIfParts.reduce(function (res, elif) {
                        return res ||
                            (isTruthy(evaluateExpressionString(elif.expression, macros)) &&
                                // path/visit hack to remove type error
                                (path.replaceWith(elif.body), true));
                    }, false);
                    if (!elseBranchHit) {
                        if (node.elsePart) {
                            path.replaceWith(node.elsePart.body);
                        }
                        else {
                            path.remove();
                        }
                    }
                }
            },
        },
        text: {
            enter: function (initialPath) {
                var path = convertPath(initialPath);
                path.node.text = expandMacros(path.node.text, macros);
            },
        },
        define_arguments: {
            enter: function (initialPath) {
                var path = convertPath(initialPath);
                var _a = path.node, identifier = _a.identifier.identifier, body = _a.body, args = _a.args;
                macros[identifier] = { args: args, body: body };
                !preserveNode(path) && path.remove();
            },
        },
        define: {
            enter: function (initialPath) {
                var path = convertPath(initialPath);
                var _a = path.node, identifier = _a.identifier.identifier, body = _a.body;
                macros[identifier] = { body: body };
                !preserveNode(path) && path.remove();
            },
        },
        undef: {
            enter: function (initialPath) {
                var path = convertPath(initialPath);
                delete macros[path.node.identifier.identifier];
                !preserveNode(path) && path.remove();
            },
        },
        error: {
            enter: function (initialPath) {
                var path = convertPath(initialPath);
                if (options.stopOnError) {
                    throw new Error(path.node.message);
                }
                !preserveNode(path) && path.remove();
            },
        },
        pragma: {
            enter: function (initialPath) {
                var path = convertPath(initialPath);
                !preserveNode(path) && path.remove();
            },
        },
        version: {
            enter: function (initialPath) {
                var path = convertPath(initialPath);
                !preserveNode(path) && path.remove();
            },
        },
        extension: {
            enter: function (initialPath) {
                var path = convertPath(initialPath);
                !preserveNode(path) && path.remove();
            },
        },
        // TODO: Causes a failure
        line: {
            enter: function (initialPath) {
                var path = convertPath(initialPath);
                !preserveNode(path) && path.remove();
            },
        },
    });
    // Even though it mutates, useful for passing around functions
    return program;
};
export { preprocessAst, preprocessComments, unescapeSrc };
