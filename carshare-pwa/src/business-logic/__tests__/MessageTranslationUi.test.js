import { describe, expect, it } from 'vitest';

async function read(relativeUrl) {
  return import('node:fs/promises').then(({ readFile }) => readFile(
    new URL(relativeUrl, import.meta.url),
    'utf8',
  ));
}

describe('translation result UI contract', () => {
  it('provides a manual close action without deleting the translation result', async () => {
    const component = await read('../../presentation/components/messaging/MessageTranslation.jsx');
    expect(component).toContain('isResultDismissed');
    expect(component).toContain('Close translation result');
    expect(component).toContain('setIsResultDismissed(true)');
    expect(component).toContain('setResult(translated)');
  });
});
