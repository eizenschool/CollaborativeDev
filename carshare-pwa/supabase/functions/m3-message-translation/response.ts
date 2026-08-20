function textContent(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";

  return value
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const record = part as Record<string, unknown>;
      return typeof record.text === "string"
        ? record.text
        : typeof record.content === "string"
          ? record.content
          : "";
    })
    .join("")
    .trim();
}

/**
 * Workers AI text-generation models can return either the legacy `response`
 * field or the current OpenAI-compatible `choices[].message.content` shape.
 */
export function completionText(result: Record<string, unknown>): string {
  for (const key of ["response", "generated_text", "text", "output_text"]) {
    const direct = textContent(result[key]);
    if (direct) return direct;
  }

  const choices = Array.isArray(result.choices) ? result.choices : [];
  for (const choice of choices) {
    if (!choice || typeof choice !== "object") continue;
    const record = choice as Record<string, unknown>;
    const direct = textContent(record.text);
    if (direct) return direct;
    if (record.message && typeof record.message === "object") {
      const message = record.message as Record<string, unknown>;
      const content = textContent(message.content);
      if (content) return content;
    }
  }

  const output = Array.isArray(result.output) ? result.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const content = textContent(record.content) || textContent(record.text);
    if (content) return content;
  }

  return "";
}
