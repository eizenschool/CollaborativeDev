import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

function jsxFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? jsxFiles(path) : (extname(entry.name) === '.jsx' ? [path] : []);
  });
}

describe('Module 4 presentation copy', () => {
  it('does not expose internal module labels or implementation-cost wording to users', () => {
    const components = resolve(import.meta.dirname, '../components');
    const source = jsxFiles(components).map((path) => readFileSync(path, 'utf8')).join('\n');

    expect(source).not.toMatch(/Module\s+[1-9]/i);
    expect(source).not.toMatch(/\b(?:FR|UC)[- ]?\d/i);
    expect(source).not.toMatch(/billable photos|score explanation/i);
  });

  it('keeps nearby coordinates out of URLs and browser persistence', () => {
    const picker = readFileSync(resolve(
      import.meta.dirname,
      '../components/DestinationRecommendationPicker.jsx'
    ), 'utf8');

    expect(picker).toContain('getCurrentLocationPreview');
    expect(picker).toContain('loadNearbySearchRecommendations');
    expect(picker).toContain('createPortal');
    expect(picker).toContain('document.body');
    expect(picker).not.toMatch(/localStorage|sessionStorage|URLSearchParams/);
  });
});
