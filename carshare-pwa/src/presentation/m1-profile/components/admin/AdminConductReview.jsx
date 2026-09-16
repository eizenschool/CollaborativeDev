// ===== PRESENTATION LAYER (AdminConductReview) =====
// The in-app side of database/sql/106_m1_admin_conduct_review.sql and
// 107_m1_safety_report_queue.sql. Reachable only by URL (/admin/conduct) -
// same reasoning as /admin/identity.
//
// 107_m1 adds the self-service case queue 106_m1's own header said was
// missing: any signed-in member can flag another from their public profile
// (PublicProfile.jsx), and CaseQueue below lists the open reports. By user
// decision, that queue is now the ONLY way into a member's standing here -
// there is no manual "paste a user ID" fallback, since a raw Supabase UUID
// is not something a reviewer has any easy way to get on its own (see
// PublicProfile.jsx's own header on the missing copy-ID affordance). A
// report with no queue entry - raised by direct contact, elsewhere in the
// app - has no path into this page today. Still deliberately narrow - no
// automatic M2 (ride/check-in evidence), M3 (message evidence), or M5 (trip
// records) intake, per the Conduct Severity Rulebook's own scoping note; a
// report is free text a member wrote, not pulled evidence. Resolving a
// queue entry (Dismiss / Mark resolved) is a separate, manual action from
// confirming a Trust Case, since a report can turn out to need no action, or
// one confirmed case might close several open reports at once.
//
// The `authorized` check below is a UX convenience only. Every action here
// is re-checked server-side by admin_get_reputation_summary /
// admin_apply_conduct_outcome / admin_clear_reputation_hold /
// admin_list_safety_reports / admin_resolve_safety_report's own admin check,
// so this component being bypassed would still fail at the database.
import { useEffect, useState } from 'react';
import { useAuth } from '../../../shared/context/AuthContext.jsx';
import { isIdentityReviewAdmin } from '../../../../business-logic/m1-profile/IdentityVerificationService.js';
import {
  CONDUCT_SEVERITY_TIERS,
  conductEscalationCounts,
  describeConductSeverity,
  describeReputationEvent,
  resolveConductSeverity
} from '../../../../business-logic/m1-profile/ReputationPolicy.js';
import { ReputationService } from '../../../../business-logic/m1-profile/ReputationService.js';
import { Chip, StatusBadge } from '../../../shared/components/ui/Primitives.jsx';

const BUTTON_STYLE = { width: 'auto', padding: '10px 20px' };
const REASON_MAX_LENGTH = 500;

// Fetched once as 'all' and filtered client-side, so switching tabs is
// instant and each tab can show its own count without a second round trip.
const REPORT_STATUS_TABS = [
  { key: 'open', label: 'Open' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'dismissed', label: 'Dismissed' }
];

const REPORT_STATUS_COPY = {
  open: { label: 'Open', tone: 'warning' },
  resolved: { label: 'Resolved', tone: 'success' },
  dismissed: { label: 'Dismissed', tone: 'neutral' }
};

const REPORT_EMPTY_COPY = {
  open: "No open reports right now - a member's \"Report this member\" action will show up here.",
  resolved: 'No resolved reports yet.',
  dismissed: 'No dismissed reports yet.'
};

function CaseQueue({ onReview }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [notes, setNotes] = useState({});
  const [statusFilter, setStatusFilter] = useState('open');

  async function load() {
    setLoading(true);
    setError('');
    try {
      setReports(await ReputationService.adminListSafetyReports('all'));
    } catch (cause) {
      setError(cause.message || 'The case queue could not be loaded.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function resolve(reportId, status) {
    setBusyId(reportId);
    setError('');
    try {
      await ReputationService.adminResolveSafetyReport(reportId, status, notes[reportId]?.trim() || null);
      await load();
    } catch (cause) {
      setError(cause.message || 'That report could not be updated.');
    } finally {
      setBusyId('');
    }
  }

  const counts = reports.reduce((acc, report) => {
    acc[report.status] = (acc[report.status] || 0) + 1;
    return acc;
  }, {});
  const visible = reports
    .filter((report) => report.status === statusFilter)
    .sort((a, b) => (statusFilter === 'open'
      ? new Date(a.createdAt) - new Date(b.createdAt)
      : new Date(b.resolvedAt || b.createdAt) - new Date(a.resolvedAt || a.createdAt)));

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <p className="card-title">Case queue</p>
      <p className="card-subtitle" style={{ marginBottom: 14 }}>
        Reports members raised from another member&apos;s public profile. Reviewing does not change anyone&apos;s
        score by itself - use Confirm a Trust Case below for that.
      </p>

      <div className="dsc-filters" role="group" aria-label="Filter by report status" style={{ gap: 12, marginBottom: 18 }}>
        {REPORT_STATUS_TABS.map((tab) => (
          <Chip key={tab.key} selected={statusFilter === tab.key} onClick={() => setStatusFilter(tab.key)}>
            {tab.label} ({counts[tab.key] || 0})
          </Chip>
        ))}
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}
      {loading && <p className="card-subtitle" style={{ marginBottom: 0 }}>Loading…</p>}
      {!loading && visible.length === 0 && (
        <p className="card-subtitle" style={{ marginBottom: 0 }}>{REPORT_EMPTY_COPY[statusFilter]}</p>
      )}
      {!loading && visible.length > 0 && (
        <ul className="reputation-event-list">
          {visible.map((report) => (
            <li key={report.id} style={{ flexDirection: 'column', alignItems: 'stretch', justifyContent: 'flex-start', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                <div>
                  <strong>{report.reporterName} reported {report.reportedName}</strong>
                  {report.createdAt && <span>{new Date(report.createdAt).toLocaleDateString('en-MY')}</span>}
                </div>
                <StatusBadge tone={REPORT_STATUS_COPY[report.status].tone}>
                  {REPORT_STATUS_COPY[report.status].label}
                </StatusBadge>
              </div>
              <p className="card-subtitle" style={{ margin: 0 }}>{report.reason}</p>
              {report.rideId && <p className="card-subtitle" style={{ margin: 0 }}>Ride: {report.rideId}</p>}
              {report.status === 'open' ? (
                <>
                  <div className="input-wrap">
                    <input
                      value={notes[report.id] || ''}
                      maxLength={REASON_MAX_LENGTH}
                      onChange={(event) => setNotes((prev) => ({ ...prev, [report.id]: event.target.value }))}
                      placeholder="Resolution note (optional)"
                    />
                  </div>
                  <small>{(notes[report.id] || '').length}/{REASON_MAX_LENGTH}</small>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <button type="button" className="btn-primary" style={BUTTON_STYLE} disabled={Boolean(busyId)} onClick={() => onReview(report.reportedUserId)}>
                      Review
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      style={BUTTON_STYLE}
                      disabled={Boolean(busyId)}
                      onClick={() => resolve(report.id, 'resolved')}
                    >
                      {busyId === report.id ? 'Working…' : 'Mark resolved'}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      style={BUTTON_STYLE}
                      disabled={Boolean(busyId)}
                      onClick={() => resolve(report.id, 'dismissed')}
                    >
                      Dismiss
                    </button>
                  </div>
                </>
              ) : (
                <p className="card-subtitle" style={{ margin: 0 }}>
                  {REPORT_STATUS_COPY[report.status].label}
                  {report.resolvedAt ? ` ${new Date(report.resolvedAt).toLocaleDateString('en-MY')}` : ''}
                  {report.resolutionNote ? ` — "${report.resolutionNote}"` : ''}
                  <button
                    type="button"
                    className="btn-link"
                    style={{ marginLeft: 10 }}
                    onClick={() => onReview(report.reportedUserId)}
                  >
                    Review member
                  </button>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ConductCaseForm({ userId, summary, onChanged }) {
  const [eventType, setEventType] = useState(CONDUCT_SEVERITY_TIERS[0].key);
  const [reason, setReason] = useState('');
  const [rideId, setRideId] = useState('');
  const [setHold, setSetHold] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  const selectedTier = describeConductSeverity(eventType);
  const recentCounts = conductEscalationCounts(summary.events);
  const preview = resolveConductSeverity(eventType, recentCounts);
  const previewTier = describeConductSeverity(preview.effectiveType);

  async function confirm(event) {
    event.preventDefault();
    if (!reason.trim()) {
      setError('A reason is required to confirm a Trust Case.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await ReputationService.adminApplyConductOutcome(userId, eventType, reason.trim(), {
        rideId: rideId.trim() || null,
        setHold
      });
      setConfirmed(true);
      setReason('');
      setRideId('');
      setSetHold(false);
      onChanged();
    } catch (cause) {
      setError(cause.message || 'That outcome could not be recorded.');
      setConfirmed(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={confirm} style={{ marginBottom: 20 }}>
      <p className="card-title">Confirm a Trust Case</p>

      <div className="dsc-filters" role="group" aria-label="Severity" style={{ gap: 12, margin: '10px 0 16px' }}>
        {CONDUCT_SEVERITY_TIERS.map((tier) => (
          <Chip key={tier.key} selected={eventType === tier.key} onClick={() => { setEventType(tier.key); setConfirmed(false); }}>
            {tier.label} ({tier.delta})
          </Chip>
        ))}
      </div>

      <div className="field">
        <label htmlFor="conduct-reason">Reason shown in the member&apos;s ledger</label>
        <div className="input-wrap">
          <input
            id="conduct-reason"
            value={reason}
            maxLength={REASON_MAX_LENGTH}
            onChange={(event) => setReason(event.target.value)}
            placeholder="e.g. Confirmed harassment reported by a ride passenger."
          />
        </div>
        <small>{reason.length}/{REASON_MAX_LENGTH}</small>
      </div>

      <div className="field">
        <label htmlFor="conduct-ride-id">Related ride ID (optional)</label>
        <div className="input-wrap">
          <input
            id="conduct-ride-id"
            value={rideId}
            onChange={(event) => setRideId(event.target.value)}
            placeholder="Leave blank if this is not tied to one ride"
          />
        </div>
      </div>

      {!selectedTier.hold && (
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '14px 0' }}>
          <input type="checkbox" checked={setHold} onChange={(event) => setSetHold(event.target.checked)} />
          Place a hold on this account while it is reviewed further
        </label>
      )}

      <div className="alert alert-info" style={{ margin: '14px 0' }}>
        {preview.escalated
          ? `This member already has ${recentCounts[preview.requestedType]} prior confirmed ${selectedTier.label} case${recentCounts[preview.requestedType] === 1 ? '' : 's'} in the window that matters - this will actually be recorded as ${previewTier.label} (${preview.delta})${preview.hold ? ', with a hold' : ''}, not the ${selectedTier.label} selected above.`
          : `This will be recorded as ${previewTier.label} (${preview.delta})${preview.hold ? ', with a hold' : ', no automatic hold'}.`}
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}
      {confirmed && <p className="card-subtitle" style={{ marginBottom: 12 }}>Outcome recorded.</p>}

      <button type="submit" className="btn-primary" style={BUTTON_STYLE} disabled={busy}>
        {busy ? 'Confirming…' : 'Confirm Trust Case'}
      </button>
    </form>
  );
}

function HoldCard({ userId, onCleared }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function clear() {
    setBusy(true);
    setError('');
    try {
      await ReputationService.adminClearHold(userId, reason.trim() || null);
      onCleared();
    } catch (cause) {
      setError(cause.message || 'That hold could not be cleared.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <p className="card-title">Safety hold is active</p>
      <p className="card-subtitle" style={{ marginBottom: 14 }}>
        This account cannot publish, request, or take any ride action while a hold is active. Clear it only after
        a documented appeal outcome - this does not restore any deducted score.
      </p>
      <div className="field">
        <label htmlFor="hold-reason">Reason for clearing (for your own record)</label>
        <div className="input-wrap">
          <input
            id="hold-reason"
            value={reason}
            maxLength={REASON_MAX_LENGTH}
            onChange={(event) => setReason(event.target.value)}
            placeholder="e.g. Appeal upheld the reduction, case closed."
          />
        </div>
        <small>{reason.length}/{REASON_MAX_LENGTH}</small>
      </div>
      {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}
      <button type="button" className="btn-secondary" style={BUTTON_STYLE} disabled={busy} onClick={clear}>
        {busy ? 'Clearing…' : 'Clear hold'}
      </button>
    </div>
  );
}

export default function AdminConductReview() {
  const { user } = useAuth();
  const authorized = isIdentityReviewAdmin(user);
  const [target, setTarget] = useState(null);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState('');

  async function reviewMember(userId) {
    setReviewing(true);
    setError('');
    try {
      const summary = await ReputationService.adminGetSummary(userId);
      setTarget({ userId, summary });
    } catch (cause) {
      setError(cause.message || 'That member could not be found.');
    } finally {
      setReviewing(false);
    }
  }

  async function refresh() {
    if (!target) return;
    try {
      const summary = await ReputationService.adminGetSummary(target.userId);
      setTarget({ userId: target.userId, summary });
    } catch (cause) {
      setError(cause.message || 'Could not refresh this member.');
    }
  }

  if (!authorized) {
    return (
      <div className="card">
        <p className="card-title">Not authorized</p>
        <p className="card-subtitle">This page is restricted to Trust &amp; Safety reviewers.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="panel-head" style={{ marginBottom: 24 }}>
        <h2>Confirm a Trust Case</h2>
        <p>Record a reviewed conduct outcome against a member&apos;s reputation</p>
      </div>

      <CaseQueue onReview={reviewMember} />

      {reviewing && <p className="card-subtitle">Loading member…</p>}
      {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}

      {target && (
        <>
          <div className="card" style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
              <p className="card-title" style={{ marginBottom: 0, wordBreak: 'break-all' }}>{target.userId}</p>
              {target.summary.hold && <StatusBadge tone="danger">Safety hold active</StatusBadge>}
            </div>
            <ul className="reputation-rules">
              <li>
                Current score: {target.summary.score}/100 -{' '}
                <span className={`reputation-standing reputation-standing-${target.summary.standing.key}`} style={{ marginTop: 0 }}>
                  {target.summary.standing.label}
                </span>
              </li>
              <li>Evidence rides: {target.summary.evidenceCount}{target.summary.provisional ? ' (still provisional)' : ''}</li>
            </ul>
            {target.summary.events.length > 0 ? (
              <>
                <p className="card-title" style={{ marginTop: 16, fontSize: 14 }}>Prior confirmed conduct</p>
                <ul className="reputation-event-list">
                  {target.summary.events.map((event) => (
                    <li key={event.id}>
                      <div>
                        <strong>{describeReputationEvent(event.type)}</strong>
                        {event.createdAt && <span>{new Date(event.createdAt).toLocaleDateString('en-MY')}</span>}
                      </div>
                      <span className="event-negative">{event.delta}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="card-subtitle" style={{ marginTop: 16, marginBottom: 0 }}>No prior confirmed conduct on record.</p>
            )}
          </div>

          {target.summary.hold && <HoldCard userId={target.userId} onCleared={refresh} />}

          <ConductCaseForm userId={target.userId} summary={target.summary} onChanged={refresh} />
        </>
      )}
    </div>
  );
}
