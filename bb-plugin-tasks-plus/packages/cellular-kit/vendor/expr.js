// kit/expr.js — the pure arithmetic evaluator behind the numeric Input's value field.
//
// evalExpr(src): number — evaluates "1920/2", "(8+2)*4", "100*1.5"; returns NaN for anything that
// does not parse. NaN is a deliberate drop-in for parseFloat: the Input shell (kit/input.js, set())
// already reverts the field when its parse is NaN, so this plugs into the existing seam with no
// change to the shell contract. NEVER use eval()/new Function() here — see
// docs/decisions/input-expr-no-eval.md (security + purity).
//
// Grammar (recursive descent, standard precedence, parens, chained unary ±):
//   expr   := term (('+' | '-') term)*
//   term   := factor (('*' | '/') factor)*
//   factor := ('-'|'+') factor | primary
//   primary:= number | '(' expr ')'

// Split source into a token list: numbers become JS numbers, operators/parens stay as 1-char
// strings. Returns null on an unrecognised character (the whole parse then becomes NaN).
function tokenize(src) {
  var s = String(src), tokens = [], i = 0;
  while (i < s.length) {
    var c = s[i];
    if (c === " " || c === "\t") { i++; continue; }
    if (c === "+" || c === "-" || c === "*" || c === "/" || c === "(" || c === ")") { tokens.push(c); i++; continue; }
    if ((c >= "0" && c <= "9") || c === ".") {
      var j = i;
      while (j < s.length && ((s[j] >= "0" && s[j] <= "9") || s[j] === ".")) j++;
      var n = Number(s.slice(i, j));
      if (!Number.isFinite(n)) return null;   // "1..2" → Number is NaN → reject the whole input
      tokens.push(n); i = j; continue;
    }
    return null;   // unrecognised character
  }
  return tokens;
}

export function evalExpr(src) {
  var tokens = tokenize(src);
  if (tokens === null || tokens.length === 0) return NaN;

  // Local cursor over the token list. peek() reads the current token (undefined past the end),
  // eat() returns it and advances, fail() aborts the descent — caught once below and turned into NaN.
  // All of this mutates only locals, invisible outside, so evalExpr stays a pure string→number.
  var pos = 0;
  var peek = function () { return tokens[pos]; };
  var eat = function () { return tokens[pos++]; };
  function fail() { throw 0; }

  // Recursive descent over the grammar. Each level reads through peek()/eat() and fail()s on the
  // unexpected. Binary levels fold LEFT with a while-loop (so 10-6-1 = 3 and 10-6/2 = 7, not right-
  // associated); unary recurses (so -+-2 chains). fail() unwinds to the single catch below.
  function parsePrimary() {
    var t = peek();
    if (typeof t === "number") { eat(); return t; }
    if (t === "(") { eat(); var v = parseExpr(); if (eat() !== ")") fail(); return v; }
    fail();
  }
  function parseFactor() {
    var t = peek();
    if (t === "-") { eat(); return -parseFactor(); }
    if (t === "+") { eat(); return parseFactor(); }
    return parsePrimary();
  }
  function parseTerm() {
    var v = parseFactor();
    while (peek() === "*" || peek() === "/") {
      var op = eat(), rhs = parseFactor();
      v = op === "*" ? v * rhs : v / rhs;
    }
    return v;
  }
  function parseExpr() {
    var v = parseTerm();
    while (peek() === "+" || peek() === "-") {
      var op = eat(), rhs = parseTerm();
      v = op === "+" ? v + rhs : v - rhs;
    }
    return v;
  }

  try {
    var v = parseExpr();
    if (pos !== tokens.length) return NaN;   // leftover tokens ("2 3", "1+2)") → reject
    return v;   // every grammar production returns a number or fail()s, so v is always numeric here
  } catch (_) {
    // Any parse abort (fail()'s throw) OR a RangeError from deep-nesting recursion → NaN. Keep the
    // catch broad: narrowing it (e.g. `if (e !== 0) throw e`) would let a stack overflow escape and
    // break totality — see the deep-nesting test in test/kit/expr.test.js.
    return NaN;
  }
}
