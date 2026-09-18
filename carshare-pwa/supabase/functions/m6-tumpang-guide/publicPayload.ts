type JsonRow = Record<string, unknown>;

const PRIVATE_PROVIDER_KEYS = new Set(["provider", "model", "providerModel", "intentProvider"]);

/**
 * Remove provider ownership metadata before a Guide response crosses the
 * Edge boundary. Provider/model details remain available to the private
 * audit RPCs, but are never part of the public UI payload, including nested
 * place-information objects.
 */
export function sanitizePublicGuidePayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizePublicGuidePayload);
  if (!value || typeof value !== "object") return value;

  const output: JsonRow = {};
  for (const [key, child] of Object.entries(value as JsonRow)) {
    if (PRIVATE_PROVIDER_KEYS.has(key)) continue;
    if (key === "source" && ["gemini", "groq"].includes(String(child))) {
      output[key] = "ai";
      continue;
    }
    output[key] = sanitizePublicGuidePayload(child);
  }
  return output;
}
