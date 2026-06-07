import type { DataType, Reducer } from "@construct/dsl";

/**
 * Keys accepted by {@link ChannelHandle.path}. When the channel carries a known
 * object shape (a json channel typed from a Zod schema), only its keys are
 * allowed; otherwise any string passes. Keeps `.path()` honest without forcing
 * every untyped channel to declare a schema.
 */
type PathKey<T> = [T] extends [object] ? keyof T & string : string;

/**
 * Author-time references that stand in for runtime values. The builder accepts
 * these wherever the DSL expects a channel name, a resource name, or an
 * expression string, and serializes them to the canonical wire form:
 *   - a {@link ChannelHandle} used as a value -> `$.name` (a read reference)
 *   - `handle.path("k")`                       -> `$.name.k`
 *   - a handle interpolated into a template     -> `{{name}}`
 * Keeping the two forms distinct (read vs interpolation) mirrors the engine's
 * expression conventions: `$.x` yields the value, `{{x}}` substitutes into text.
 */

export interface ChannelInit {
  reducer?: Reducer;
  initial?: unknown;
  description?: string;
}

/**
 * A typed handle to a declared state channel. The generic `T` is the value the
 * channel carries (inferred from a Zod schema for json channels); it is purely
 * a compile-time aid — nothing about `T` survives to the wire.
 */
export class ChannelHandle<T = unknown> {
  readonly __kind = "channel" as const;
  /** Phantom type marker so `T` is not erased to `unknown` structurally. */
  declare readonly __type: T;

  constructor(
    readonly name: string,
    readonly type: DataType,
    readonly reducer: Reducer,
  ) {}

  /** Read expression for the whole channel: `$.name`. */
  get $(): string {
    return `$.${this.name}`;
  }

  /** Read expression for a nested key: `$.name.key`. */
  path(key: PathKey<T>): string {
    return `$.${this.name}.${key}`;
  }

  /** Interpolation token used inside prompt templates: `{{name}}`. */
  toString(): string {
    return `{{${this.name}}}`;
  }
}

/** A handle to a declared external resource (sandbox, figma, db, …). */
export class ResourceHandle {
  readonly __kind = "resource" as const;
  constructor(
    readonly name: string,
    readonly kind: string,
    readonly scope: "run" | "session",
  ) {}

  toString(): string {
    return this.name;
  }
}

export function isChannel(value: unknown): value is ChannelHandle {
  return value instanceof ChannelHandle;
}

export function isResource(value: unknown): value is ResourceHandle {
  return value instanceof ResourceHandle;
}

/** Any value the builder accepts where the DSL wants an expression string. */
export type ExprInput = string | number | boolean | ChannelHandle;

/** Serialize an expression input to its wire string (handle -> `$.name`). */
export function toExpr(value: ExprInput): string {
  if (isChannel(value)) return value.$;
  return typeof value === "string" ? value : String(value);
}

/** Serialize a channel reference (handle or bare name) to a channel name. */
export function toChannel(value: ChannelHandle | string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return isChannel(value) ? value.name : value;
}

/** Serialize a resource reference (handle or bare name) to a resource name. */
export function toResource(value: ResourceHandle | string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return isResource(value) ? value.name : value;
}

/**
 * Build a prompt template, substituting each interpolated channel handle as a
 * `{{name}}` token. `f.tpl\`Critique ${shot} against ${tokens}\`` yields
 * `"Critique {{shot}} against {{tokens}}"`. Plain values are stringified as-is.
 */
export function tpl(
  strings: TemplateStringsArray,
  ...values: Array<ChannelHandle | ExprInput>
): string {
  let out = "";
  strings.forEach((chunk, i) => {
    out += chunk;
    if (i < values.length) {
      const v = values[i];
      out += isChannel(v) ? `{{${v.name}}}` : String(v);
    }
  });
  return out;
}
