// Pure logic module - deliberately free of `jsr:`/`npm:` imports so Vitest
// can load it directly (see vitest.config.js's comment on why index.ts
// itself is untestable).
//
// Sightengine (api.sightengine.com/1.0/check.json) as a candidate replacement
// for Google Cloud Vision (visionCheck.ts): Vision is fully built and tested
// but non-functional live, blocked by a Google Cloud billing-account
// "payment anomaly" that affects even its free tier - see
// docs/ai/DECISIONS.md D039. This module's request/response contract was
// confirmed against real live `check.json` calls (not assumed from docs)
// before writing this, the same way Hive's `media_url`-only limit and
// Gemini's image-hang bug were both caught by testing directly.
//
// Produces the exact same ContentCheckResult shape as visionCheck.ts so
// index.ts can swap providers without touching
// src/business-logic/m1-profile/ProfileService.js's contract.
//
// Models used: nudity-2.1 (sexual content), gore-2.0 (graphic violence),
// offensive-2.0 (hate/extremist symbols, AND a `middle_finger` class - a
// category Google Vision's SafeSearch has no equivalent for; see
// visionCheck.ts's "known gap" note), ocr (raw extracted text, matched
// against the exact same regex patterns visionCheck.ts uses for OCR so
// identity_document/personal_information_visible behave identically
// regardless of which provider is active).
//
// Unlike Vision's JSON-body-with-base64 request, Sightengine's endpoint
// takes the image as multipart/form-data with the raw bytes in a `media`
// field (confirmed via their Quickstart curl/nodejs examples) - not a `url`
// parameter, which is what ruled out Hive AI for this use case (the avatar
// isn't public anywhere yet at check time).

export const FLAG_CATEGORIES = [
  "identity_document",
  "personal_information_visible",
  "sexual_content",
  "graphic_violence",
  "hate_or_extremist_symbols",
  "offensive_gesture",
  "other"
] as const;

export type FlagCategory = typeof FLAG_CATEGORIES[number];

export type ContentCheckResult = {
  flagged: boolean;
  categories: FlagCategory[];
  reason: string;
};

// Sightengine returns continuous 0-1 probabilities per class rather than
// Vision's discrete LIKELY/VERY_LIKELY buckets. 0.5 is Sightengine's own
// documented rule-of-thumb cutoff for "this class is present" - tune per
// class here if false positives/negatives show up in practice.
const THRESHOLD = 0.5;

// MyKad/IC (12 digits, optionally dashed) and common ID-document keywords in
// English and Bahasa Melayu. Matches on OCR'd text only, identical to
// visionCheck.ts's patterns so both providers flag the same content.
const ID_NUMBER_PATTERN = /\b\d{6}-?\d{2}-?\d{4}\b/;
const ID_KEYWORD_PATTERN = /MYKAD|KAD PENGENALAN|IDENTITY CARD|PASSPORT|PASPORT|DRIVING LICEN[CS]E|LESEN MEMANDU/i;
const PHONE_PATTERN = /\b(\+?60|0)1[0-9][-\s]?\d{3,4}[-\s]?\d{4}\b/;
const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[a-z]{2,}/i;

function textCategories(fullText: string): FlagCategory[] {
  const categories: FlagCategory[] = [];
  if (ID_KEYWORD_PATTERN.test(fullText) || ID_NUMBER_PATTERN.test(fullText)) {
    categories.push("identity_document");
  }
  if (PHONE_PATTERN.test(fullText) || EMAIL_PATTERN.test(fullText)) {
    categories.push("personal_information_visible");
  }
  return categories;
}

function score(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function nudityCategories(nudity: Record<string, unknown> | undefined): FlagCategory[] {
  if (!nudity) return [];
  // Only the explicit/high-severity tiers trip the flag - "suggestive" and
  // "mildly_suggestive" are deliberately excluded so an ordinary swimwear or
  // gym photo doesn't get blocked, mirroring Vision's LIKELY-or-above bar.
  const explicit = Math.max(
    score(nudity.sexual_activity), score(nudity.sexual_display),
    score(nudity.erotica), score(nudity.very_suggestive)
  );
  return explicit >= THRESHOLD ? ["sexual_content"] : [];
}

function goreCategories(gore: Record<string, unknown> | undefined): FlagCategory[] {
  if (!gore) return [];
  return score(gore.prob) >= THRESHOLD ? ["graphic_violence"] : [];
}

function offensiveCategories(offensive: Record<string, unknown> | undefined): FlagCategory[] {
  if (!offensive) return [];
  const categories: FlagCategory[] = [];
  const hate = Math.max(
    score(offensive.nazi), score(offensive.asian_swastika),
    score(offensive.confederate), score(offensive.supremacist), score(offensive.terrorist)
  );
  if (hate >= THRESHOLD) categories.push("hate_or_extremist_symbols");
  if (score(offensive.middle_finger) >= THRESHOLD) categories.push("offensive_gesture");
  return categories;
}

function isTransient(error: unknown) {
  const status = Number((error as Error & { status?: number })?.status || 0);
  return (error instanceof Error && error.name === "AbortError")
    || status === 408 || status === 429 || status >= 500 || status === 0;
}

function sightengineErrorFromBody(status: number, body: unknown) {
  const row = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const nested = row.error && typeof row.error === "object" ? row.error as Record<string, unknown> : {};
  const detail = String(nested.message || row.message || "").slice(0, 360);
  const error = new Error(`Sightengine ${status}${detail ? `: ${detail}` : ""}`) as Error & { status?: number };
  error.status = status;
  return error;
}

async function sightengineResponseError(response: Response) {
  try {
    return sightengineErrorFromBody(response.status, await response.clone().json());
  } catch {
    let detail = "";
    try { detail = (await response.text()).slice(0, 360); } catch { /* Error body is optional. */ }
    const error = new Error(`Sightengine ${response.status}${detail ? `: ${detail}` : ""}`) as Error & { status?: number };
    error.status = response.status;
    return error;
  }
}

function base64ToBlob(imageBase64: string, mimeType: string) {
  const binary = atob(imageBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType || "application/octet-stream" });
}

// Fail-open is the CALLER's decision (ProfileService.updateProfilePhoto),
// not this function's - this always either returns a real verdict or
// throws, so the business-logic layer can decide what "the check is
// unavailable" means for that specific upload flow.
export async function checkImageWithSightengine({
  apiUser, apiSecret, imageBase64, mimeType = "image/jpeg",
  fetchImpl = fetch, timeoutMs = 15_000, maxAttempts = 2
}: {
  apiUser: string; apiSecret: string; imageBase64: string; mimeType?: string;
  fetchImpl?: typeof fetch; timeoutMs?: number; maxAttempts?: number;
}): Promise<ContentCheckResult> {
  const started = Date.now();
  const attempts = Math.max(1, Math.min(2, Math.floor(maxAttempts)));
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const remaining = timeoutMs - (Date.now() - started);
    if (remaining <= 250) break;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), attempts > 1 ? Math.min(10_000, remaining) : remaining);
    try {
      const form = new FormData();
      form.append("media", base64ToBlob(imageBase64, mimeType), "avatar");
      form.append("models", "nudity-2.1,gore-2.0,offensive-2.0,ocr");
      form.append("api_user", apiUser);
      form.append("api_secret", apiSecret);
      const response = await fetchImpl(
        "https://api.sightengine.com/1.0/check.json",
        { method: "POST", signal: controller.signal, body: form }
      );
      if (!response.ok) throw await sightengineResponseError(response);
      const body = await response.json();
      if (body?.status === "failure") throw sightengineErrorFromBody(response.status, body);
      const fullText = String(body?.text?.content || "");
      const categories = [
        ...nudityCategories(body?.nudity),
        ...goreCategories(body?.gore),
        ...offensiveCategories(body?.offensive),
        ...textCategories(fullText)
      ];
      return {
        flagged: categories.length > 0,
        categories: [...new Set(categories)],
        reason: categories.length > 0 ? `Sightengine flagged: ${categories.join(", ")}.` : "No issues found."
      };
    } catch (error) {
      lastError = error;
      if (!isTransient(error) || attempt + 1 >= attempts) throw error;
      const pause = Math.min(300 + Math.floor(Math.random() * 120), Math.max(0, timeoutMs - (Date.now() - started) - 250));
      if (pause > 0) await new Promise((resolve) => setTimeout(resolve, pause));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new DOMException("Sightengine content check timed out", "AbortError");
}
