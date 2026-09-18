import { describe, expect, it } from 'vitest';
import { normalizeSafetyReport } from '../ReputationService.js';

describe('safety report queue mapping', () => {
  it('keeps the current camel-case message evidence contract', () => {
    expect(normalizeSafetyReport({ messageEvidenceId: 'evidence-id' }).messageEvidenceId)
      .toBe('evidence-id');
  });

  it('accepts the database column name as a defensive fallback', () => {
    expect(normalizeSafetyReport({ message_evidence_id: 'legacy-evidence-id' }).messageEvidenceId)
      .toBe('legacy-evidence-id');
  });

  it('identifies ordinary profile reports by a null evidence id', () => {
    expect(normalizeSafetyReport({ id: 'profile-report' }).messageEvidenceId).toBeNull();
  });
});
