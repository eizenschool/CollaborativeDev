import { describe, it, expect, vi } from 'vitest';
import { canReportMessage, createMessageReportService } from '../MessageReportService.js';

describe('message report eligibility', () => {
  const base = { id: 'message', kind: 'user', senderId: 'other', text: 'hello', attachments: [] };
  it('allows received text, image, video and voice messages', () => {
    expect(canReportMessage(base, 'viewer')).toBe(true);
    for (const kind of ['image','video','audio']) expect(canReportMessage({ ...base, text: '', attachments: [{ kind }] }, 'viewer')).toBe(true);
  });
  it.each([
    { senderId: 'viewer' }, { kind: 'system' }, { deletedAt: 'today' },
    { pendingAction: 'Sending' }, { text: '', attachments: [{ kind: 'location' }] },
  ])('does not offer report for unavailable or unsupported content: %j', (change) => {
    expect(canReportMessage({ ...base, ...change }, 'viewer')).toBe(false);
  });
  it('requires a signed-in viewer', () => expect(canReportMessage(base, null)).toBe(false));
});
describe('message report requests', () => {
  it('sends only the identifier and reason, not browser-supplied evidence or sender', async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true });
    await createMessageReportService({ invoke }).submit('message-id', '  Harassment  ');
    expect(invoke).toHaveBeenCalledWith({ action: 'submit', messageId: 'message-id', reason: 'Harassment' });
  });
  it('requires meaningful bounded reasons before making a request', () => {
    const invoke = vi.fn(); const service = createMessageReportService({ invoke });
    expect(() => service.submit('id',' ')).toThrow();
    expect(() => service.submit('id','x'.repeat(501))).toThrow();
    expect(() => service.review('id','dismissed',' ',false)).toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
  it('propagates failures instead of displaying successful submission', async () => {
    const service = createMessageReportService({ invoke: vi.fn().mockRejectedValue(new Error('Evidence copy failed')) });
    await expect(service.submit('id','Scam')).rejects.toThrow('Evidence copy failed');
  });
});
