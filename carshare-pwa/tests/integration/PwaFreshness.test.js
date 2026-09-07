import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const serviceWorker = new URL('../../src/service-worker.js', import.meta.url);
const viteConfig = new URL('../../vite.config.js', import.meta.url);

describe('PWA deployment freshness', () => {
  it('loads navigation HTML network-first without putting HTML in the precache', async () => {
    const [workerSource, configSource] = await Promise.all([
      readFile(serviceWorker, 'utf8'),
      readFile(viteConfig, 'utf8'),
    ]);

    expect(workerSource).toContain("request.mode === 'navigate'");
    expect(workerSource).toContain("cacheName: 'page-navigation-cache'");
    expect(configSource).toContain("globPatterns: ['**/*.{js,css,ico,png,svg}']");
    expect(configSource).not.toMatch(/globPatterns:\s*\[[^\]]*html/);
  });
});
