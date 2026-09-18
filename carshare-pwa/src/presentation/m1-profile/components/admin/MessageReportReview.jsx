import { useState } from 'react';
import { MessageReportService } from '../../../../business-logic/m3-messaging/MessageReportService.js';
import { ReputationService } from '../../../../business-logic/m1-profile/ReputationService.js';
import { CONDUCT_SEVERITY_TIERS, conductEscalationCounts, resolveConductSeverity } from '../../../../business-logic/m1-profile/ReputationPolicy.js';

export default function MessageReportReview({ report, onResolved }) {
  const [evidence, setEvidence] = useState(null);
  const [summary, setSummary] = useState(null);
  const [outcome, setOutcome] = useState('dismissed');
  const [reason, setReason] = useState('');
  const [remove, setRemove] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function load() {
    setBusy(true); setError('');
    try {
      const [next, standing] = await Promise.all([MessageReportService.evidence(report.messageEvidenceId), ReputationService.adminGetSummary(report.reportedUserId)]);
      setEvidence(next); setSummary(standing);
    } catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }
  async function review(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await MessageReportService.review(report.messageEvidenceId, outcome, reason, remove && outcome !== 'dismissed'); await onResolved(); }
    catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }
  const preview = outcome.startsWith('confirmed_') && summary
    ? resolveConductSeverity(outcome, conductEscalationCounts(summary.events)) : null;
  return <section aria-label="Message evidence">
    <button type="button" className="btn-secondary" disabled={busy} onClick={load}>{busy ? 'Loading…' : evidence ? 'Refresh evidence links' : 'Review message evidence'}</button>
    {error && <p role="alert" className="alert alert-error">{error}</p>}
    {evidence && <>
      {evidence.purged ? <p>Evidence expired under the retention policy.</p> : <>
        <p>Message sent: {new Date(evidence.snapshot.createdAt).toLocaleString('en-MY')}</p>
        <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{evidence.snapshot.text}</p>
        {evidence.snapshot.attachments.map((a, i) => <div key={i} style={{ marginBottom: 12 }}>
          <p>{a.name}</p>
          {a.kind === 'image' ? <img loading="lazy" src={a.url} alt="Reported attachment" style={{ maxWidth: '100%', maxHeight: 320, objectFit: 'contain' }} />
            : a.kind === 'video' ? <video controls preload="none" src={a.url} style={{ maxWidth: '100%', maxHeight: 320 }} />
              : <audio controls preload="none" src={a.url} style={{ maxWidth: '100%' }} />}
        </div>)}
      </>}
      {summary && <p>Reputation: {summary.score}/100 · {summary.standing.label} · Prior confirmed conduct: {summary.events.length}</p>}
      {report.status === 'open' && !evidence.purged && <form onSubmit={review}>
        <div className="ui-field"><label htmlFor={`outcome-${report.id}`}>Review outcome</label><select id={`outcome-${report.id}`} disabled={busy} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
          <option value="dismissed">Dismiss — no violation</option>
          <option value="warning">Record violation — no points deducted</option>
          {CONDUCT_SEVERITY_TIERS.map((tier) => <option key={tier.key} value={tier.key}>{tier.label} ({tier.delta})</option>)}
        </select></div>
        {preview && <p role="status">Effective deduction: {preview.delta}{preview.escalated ? ' (repeat-conduct escalation)' : ''}. {preview.hold ? 'A Safety hold will be applied under the existing reputation policy.' : 'No automatic Safety hold.'}</p>}
        {outcome !== 'dismissed' && <label><input type="checkbox" checked={remove} disabled={busy} onChange={(e) => setRemove(e.target.checked)} /> Remove the reported version from chat</label>}
        <div className="ui-field"><label htmlFor={`reason-${report.id}`}>Decision reason</label><textarea rows={4} style={{ resize: 'vertical' }} id={`reason-${report.id}`} required maxLength={500} value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)} /></div>
        <p>This closes all reports for this message version. A confirmed penalty is applied only once. Existing ride handling follows the current reputation policy.</p>
        <button type="submit" className="btn-primary" disabled={busy || !reason.trim()}>{busy ? 'Saving…' : 'Confirm decision'}</button>
      </form>}
      {report.status !== 'open' && <p>{evidence.decision} — {report.resolutionNote}</p>}
    </>}
  </section>;
}
