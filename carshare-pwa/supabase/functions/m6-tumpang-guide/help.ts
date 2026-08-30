import { embedHelpQuery } from "./gemini.ts";

type Client = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  from: (table: string) => any;
};

function keywordScore(section: Record<string, unknown>, query: string) {
  const terms = query.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter((term) => term.length > 1);
  const keywords = Array.isArray(section.keywords) ? section.keywords.map((item) => String(item).toLocaleLowerCase()) : [];
  return keywords.reduce((score, keyword) => score + (terms.some((term) => keyword.includes(term) || term.includes(keyword)) ? 1 : 0), 0);
}

export async function retrieveHelpSections(
  admin: Client, query: string, language: string,
  { apiKey = "", embeddingModel = "gemini-embedding-2", embedImpl = embedHelpQuery }:
  { apiKey?: string; embeddingModel?: string; embedImpl?: typeof embedHelpQuery } = {}
) {
  if (apiKey) {
    try {
      const vector = await embedImpl({ apiKey, model: embeddingModel, text: query });
      const { data, error } = await admin.rpc("m6_match_ai_help", {
        p_language: language, p_embedding: `[${vector.join(",")}]`, p_limit: 3
      });
      if (!error && Array.isArray(data) && data.length) {
        return { sections: data as Record<string, unknown>[], source: "pgvector" };
      }
    } catch { /* Verified keyword fallback below. */ }
  }

  const { data, error } = await admin.from("ai_help_sections")
    .select("stable_key,title,content,keywords,source_path,version")
    .eq("language", language).eq("is_active", true).order("version", { ascending: false }).limit(40);
  if (error) return { sections: [], source: "missing" };
  const sections = (data || []).map((section: Record<string, unknown>) => ({
    ...section, similarity: keywordScore(section, query)
  })).filter((section: Record<string, unknown>) => Number(section.similarity) > 0)
    .sort((a: Record<string, unknown>, b: Record<string, unknown>) => Number(b.similarity) - Number(a.similarity)).slice(0, 3);
  return { sections, source: sections.length ? "keyword" : "missing" };
}
