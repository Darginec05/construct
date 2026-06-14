/**
 * Tokenizer for the `Expr` string form, so the editor can render references as
 * inline chips instead of raw `$.x` / `{{x}}` text. It mirrors the engine's
 * evaluation convention (see `@construct/engine`'s `expr.ts`):
 *
 *  - a whole-string `$.path` is ONE raw-value reference (the engine returns the
 *    referenced value as-is — used in value contexts: tool args, conditions);
 *  - `{{path}}` segments interpolate into surrounding literal text (string
 *    contexts: prompts) and may repeat;
 *  - anything else is a literal.
 *
 * Tokens carry the exact source substring (`raw`) for each reference, so
 * {@link serializeExpr} round-trips losslessly: `serializeExpr(tokenizeExpr(s)) === s`.
 */
/** The engine's interpolation pattern: `{{ ... }}` with optional inner padding. */
const BRACES = /\{\{\s*([^}]+?)\s*\}\}/g;
/** Root variable name of a path: the first segment before any `.` or `[`. */
function rootOf(path) {
    const m = /^[^.[]+/.exec(path.trim());
    return m ? m[0] : path.trim();
}
function dollarPath(inner) {
    const t = inner.trim();
    return t.startsWith("$.") ? t.slice(2) : t;
}
/** Build the canonical reference source for inserting a variable from the picker. */
export function variableRef(name, form) {
    return form === "dollar" ? `$.${name}` : `{{${name}}}`;
}
/** Parse an `Expr` string into an ordered list of literal / reference tokens. */
export function tokenizeExpr(expr) {
    // Whole-string raw reference: `$.path` with no interpolation segment.
    if (!expr.includes("{{")) {
        const trimmed = expr.trim();
        if (trimmed.startsWith("$.")) {
            const tokens = [];
            const lead = expr.slice(0, expr.indexOf(trimmed));
            const tail = expr.slice(lead.length + trimmed.length);
            if (lead)
                tokens.push({ kind: "literal", text: lead });
            const path = trimmed.slice(2);
            tokens.push({ kind: "ref", form: "dollar", name: rootOf(path), path, raw: trimmed });
            if (tail)
                tokens.push({ kind: "literal", text: tail });
            return tokens;
        }
        return expr ? [{ kind: "literal", text: expr }] : [];
    }
    // Interpolation: literal text interleaved with `{{ ... }}` segments.
    const tokens = [];
    let last = 0;
    BRACES.lastIndex = 0;
    for (let m = BRACES.exec(expr); m !== null; m = BRACES.exec(expr)) {
        if (m.index > last)
            tokens.push({ kind: "literal", text: expr.slice(last, m.index) });
        const path = dollarPath(m[1] ?? "");
        tokens.push({ kind: "ref", form: "braces", name: rootOf(path), path, raw: m[0] });
        last = m.index + m[0].length;
    }
    if (last < expr.length)
        tokens.push({ kind: "literal", text: expr.slice(last) });
    return tokens;
}
/** Reassemble tokens into the source string. Inverse of {@link tokenizeExpr}. */
export function serializeExpr(tokens) {
    return tokens.map((t) => (t.kind === "literal" ? t.text : t.raw)).join("");
}
/** The distinct root variable names an expression references (for validation). */
export function expressionRefs(expr) {
    const names = new Set();
    for (const t of tokenizeExpr(expr)) {
        if (t.kind === "ref")
            names.add(t.name);
    }
    return [...names];
}
//# sourceMappingURL=expr-tokens.js.map