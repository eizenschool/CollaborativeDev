import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(import.meta.dirname, '../index.ts'), 'utf8');

describe('Tumpang Guide Edge content safety boundary', () => {
  it('uses the same dependency-free policy as the browser and checks before turn claims', () => {
    expect(source).toContain('GuideContentSafety.js');
    const safetyCheck = source.indexOf('contentSafety = classifyGuideContent');
    const claim = source.indexOf('claimGuideTurn', safetyCheck);
    const turnHandler = source.indexOf('const response = await handleTurn', safetyCheck);
    expect(safetyCheck).toBeGreaterThan(-1);
    expect(claim).toBeGreaterThan(safetyCheck);
    // checkQuota lives inside handleTurn's function declaration, which is
    // textually earlier in the module. The request flow still invokes
    // handleTurn only after this safety gate has accepted the message.
    expect(turnHandler).toBeGreaterThan(safetyCheck);
  });

  it('does not include a raw message in the content safety telemetry', () => {
    const blockStart = source.indexOf('event: "m6_guide_content_safety_block"');
    const blockEnd = source.indexOf('return json', blockStart);
    const telemetry = source.slice(blockStart, blockEnd);
    expect(telemetry).not.toContain('body.message');
    expect(telemetry).toContain('category: contentSafety.category');
    expect(telemetry).toContain('policyVersion: contentSafety.policyVersion');
  });

  it('sanitizes previously submitted user messages before they can enter a provider prompt', () => {
    expect(source).toContain('safeSubmittedRecentMessages');
    expect(source).toContain('text: safety.decision === "block" ? "" : safety.sanitizedText');
  });

  it('returns dedicated safety reasons instead of pretending that a provider or quota failed', () => {
    expect(source).toContain('reason: "content_safety_blocked"');
    expect(source).toContain('reason: "content_safety_unavailable"');
    expect(source).toContain('inputSource: body.inputSource === "voice" ? "voice" : "text"');
  });
});
