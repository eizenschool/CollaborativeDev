import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { checkText, POLICY_VERSION, TEXT_MODEL } from '../supabase/functions/_shared/m2ContentPolicy.mjs';
import { moderationCases } from './m2-moderation-cases.mjs';

// Run using environment variables or node --env-file=<private local file>.
// Deliberately never loads the app's public VITE_* credentials or enables production.
const accountId = process.env.M2_CLOUDFLARE_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.M2_CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_AI_TOKEN;
const resultsFile = process.argv[2] === '--results' ? process.argv[3] : null;
if (!resultsFile && (!accountId || !token)) {
  console.error('Not evaluated: configure M2_CLOUDFLARE_ACCOUNT_ID and M2_CLOUDFLARE_API_TOKEN in the local process environment. Do not paste secrets into chat.');
  process.exit(2);
}
const results = [];
if (resultsFile) {
  const supplied = JSON.parse(await readFile(resultsFile, 'utf8'));
  if (!Array.isArray(supplied)) throw new Error('Expected an array of evaluator results');
  const seen = new Set();
  for (const row of supplied) {
    const item = moderationCases.find((item) => item.id === row.id);
    if (!item || seen.has(row.id) || row.policyVersion !== POLICY_VERSION || row.model !== TEXT_MODEL
      || !['approved','rejected','unavailable'].includes(row.actual)) throw new Error('Invalid, duplicate or incompatible evaluation result');
    seen.add(row.id);
    results.push({ id: item.id, language: item.language, expected: item.expected, actual: row.actual, durationMs: row.durationMs });
  }
} else for (const item of moderationCases) {
  const started = Date.now();
  try {
    const verdict = await checkText({ accountId, token, text: { [item.field]: item.text } });
    results.push({ id: item.id, language: item.language, expected: item.expected, actual: verdict[item.field].status, durationMs: Date.now() - started });
  } catch {
    results.push({ id: item.id, language: item.language, expected: item.expected, actual: 'unavailable', durationMs: Date.now() - started });
    // Do not exhaust the free tier with a retry loop on quota/config errors.
    break;
  }
  console.log(`${results.length}/${moderationCases.length}: ${item.id} ${results.at(-1).actual}`);
}
const languages = Object.fromEntries(['en','zh','ms','mixed'].map((language) => {
  const rows = results.filter((r) => r.language === language);
  const safe = rows.filter((r) => r.expected === 'approved');
  const falsePositiveRate = safe.length ? safe.filter((r) => r.actual === 'rejected').length / safe.length : 1;
  return [language, { checked: rows.length, falsePositiveRate, passed: rows.length === 30 && falsePositiveRate <= 0.05 && rows.every((r) => r.actual !== 'unavailable' && (r.expected !== 'rejected' || r.actual === 'rejected')) }];
}));
const report = { evaluatedAt: new Date().toISOString(), policyVersion: POLICY_VERSION, model: TEXT_MODEL, passed: Object.values(languages).every((r) => r.passed), languages, results };
await mkdir('test-results', { recursive: true });
await writeFile('test-results/m2-moderation-evaluation.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ passed: report.passed, languages }));
process.exitCode = report.passed ? 0 : 1;
