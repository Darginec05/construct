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
export type ExprRefForm = "dollar" | "braces";
export type ExprToken = {
    kind: "literal";
    text: string;
} | {
    kind: "ref";
    form: ExprRefForm;
    /** Root variable name (the registry key), e.g. "user" for `$.user.id`. */
    name: string;
    /** Full path after the root, e.g. "user.id" for `$.user.id`. */
    path: string;
    /** Exact source substring, e.g. "$.user.id" or "{{ user.id }}". */
    raw: string;
};
/** Build the canonical reference source for inserting a variable from the picker. */
export declare function variableRef(name: string, form: ExprRefForm): string;
/** Parse an `Expr` string into an ordered list of literal / reference tokens. */
export declare function tokenizeExpr(expr: string): ExprToken[];
/** Reassemble tokens into the source string. Inverse of {@link tokenizeExpr}. */
export declare function serializeExpr(tokens: ExprToken[]): string;
/** The distinct root variable names an expression references (for validation). */
export declare function expressionRefs(expr: string): string[];
//# sourceMappingURL=expr-tokens.d.ts.map