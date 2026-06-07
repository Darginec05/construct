/**
 * Suggested model ids per provider. These are *suggestions* surfaced via a
 * datalist — `ModelRef.model` is a free string, so any value (including newer
 * models) can still be typed. Update as providers ship new models.
 */
export const MODEL_PRESETS: Record<string, readonly string[]> = {
  anthropic: ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
  openai: ["gpt-4o", "gpt-4o-mini", "o3", "o3-mini", "o1"],
  gemini: ["gemini-2.0-pro", "gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
  fake: ["fake", "echo"],
};

export function modelPresets(provider: unknown): readonly string[] {
  return (typeof provider === "string" && MODEL_PRESETS[provider]) || [];
}
