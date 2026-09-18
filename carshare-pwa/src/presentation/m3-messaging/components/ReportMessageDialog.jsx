import { useState } from 'react';
import AdaptiveDialog from '../../shared/components/ui/AdaptiveDialog.jsx';
import { MessageReportService } from '../../../business-logic/m3-messaging/MessageReportService.js';

export default function ReportMessageDialog({ message, onClose }) {
  const [category, setCategory] = useState('Harassment');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await MessageReportService.submit(message.id, `${category}${details.trim() ? ': ' + details.trim() : ''}`); setDone(true); }
    catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }
  return <AdaptiveDialog open title="Report message" onClose={() => { if (!busy) onClose(); }}>
    {done ? <><p role="status">Report received. An administrator will review it.</p><button type="button" className="btn-primary" onClick={onClose}>Done</button></> :
      <form onSubmit={submit}>
        <p>This message and its attachments will be saved privately for administrator review, even if the original is deleted. Evidence is removed 90 days after the case closes.</p>
        <div className="ui-field"><label htmlFor="message-report-category">Reason</label><select id="message-report-category" value={category} onChange={(e) => setCategory(e.target.value)} disabled={busy}>
          {['Harassment', 'Sexual content', 'Violence or threats', 'Scam', 'Other'].map((value) => <option key={value}>{value}</option>)}
        </select></div>
        <div className="ui-field"><label htmlFor="message-report-detail">Additional details (optional)</label><textarea rows={4} style={{ resize: 'vertical' }} id="message-report-detail" maxLength={450} value={details} onChange={(e) => setDetails(e.target.value)} disabled={busy} /></div>
        {error && <p className="alert alert-error" role="alert">{error}</p>}
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving report…' : 'Submit report'}</button>
      </form>}
  </AdaptiveDialog>;
}
