// ===== PRESENTATION LAYER (AdminIdentityReview) =====
// The in-app side of database/sql/097_m1_admin_identity_review.sql. Reachable
// only by URL (/admin/identity) - it is deliberately not on the primary nav,
// same reasoning as the /assistant route: this is not a new persistent
// navigation destination for every member.
//
// The `authorized` check below is a UX convenience only. Every action here
// (listing another member's row, opening their document, approving or
// rejecting) is re-checked server-side by RLS or by
// public.admin_review_identity_verification's own admin check, so this
// component being bypassed would still fail at the database.
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../../context/AuthContext.jsx';
import {
  describeIdentityStatus,
  IDENTITY_STATUS,
  IdentityVerificationService,
  isIdentityReviewAdmin
} from '../../../business-logic/IdentityVerificationService.js';
import { ProfileService } from '../../../business-logic/ProfileService.js';
import { IdentityDocumentPreview } from '../profile/IdentityVerificationCard.jsx';
import { Chip } from '../ui/Primitives.jsx';

const STATUS_TABS = [IDENTITY_STATUS.PENDING, IDENTITY_STATUS.APPROVED, IDENTITY_STATUS.REJECTED];
// btn-primary/btn-secondary are full-width by default (see BasicInfoCard's
// Save Changes button) - these actions sit next to each other, not stacked.
const BUTTON_STYLE = { width: 'auto', padding: '10px 20px' };

function SubmissionCard({ submission, onReviewed }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');

  async function review(outcome, reviewNote) {
    setBusy(true);
    setError('');
    try {
      await IdentityVerificationService.adminReview(submission.userId, outcome, reviewNote || null);
      onReviewed();
    } catch (cause) {
      setError(cause.message || 'That review could not be saved.');
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <p className="card-title" style={{ marginBottom: 10 }}>{submission.fullName || submission.userId}</p>
      <ul className="reputation-rules" style={{ marginBottom: 18 }}>
        <li>MyKad {submission.icNumber || 'not recorded'}</li>
        {submission.licenseExpiry && (
          <li>Licence expires {new Date(submission.licenseExpiry).toLocaleDateString('en-MY')}</li>
        )}
        {submission.submittedAt && (
          <li>Submitted {new Date(submission.submittedAt).toLocaleString('en-MY')}</li>
        )}
        <li>Status: {describeIdentityStatus(submission.status)}</li>
        {submission.status === IDENTITY_STATUS.REJECTED && submission.reviewNote && (
          <li>Previous note: {submission.reviewNote}</li>
        )}
      </ul>

      {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <IdentityDocumentPreview path={submission.documentPath} label="MyKad photo" />
        <IdentityDocumentPreview path={submission.licenseDocumentPath} label="Driving licence photo" />
        {submission.status !== IDENTITY_STATUS.APPROVED && (
          <button
            type="button"
            className="btn-primary"
            style={BUTTON_STYLE}
            disabled={busy}
            onClick={() => review(IDENTITY_STATUS.APPROVED)}
          >
            Approve
          </button>
        )}
        {submission.status !== IDENTITY_STATUS.REJECTED && !rejecting && (
          <button type="button" className="btn-secondary" style={BUTTON_STYLE} disabled={busy} onClick={() => setRejecting(true)}>
            Reject
          </button>
        )}
      </div>

      {rejecting && (
        <div className="field" style={{ marginTop: 18 }}>
          <label htmlFor={`reject-note-${submission.userId}`}>Reason shown to the member</label>
          <div className="input-wrap">
            <input
              id={`reject-note-${submission.userId}`}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="e.g. Photo is blurry - please retake in good lighting."
            />
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
            <button
              type="button"
              className="btn-primary"
              style={BUTTON_STYLE}
              disabled={busy}
              onClick={() => review(IDENTITY_STATUS.REJECTED, note)}
            >
              Confirm reject
            </button>
            <button
              type="button"
              className="btn-secondary"
              style={BUTTON_STYLE}
              disabled={busy}
              onClick={() => { setRejecting(false); setNote(''); }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminIdentityReview() {
  const { user } = useAuth();
  const authorized = isIdentityReviewAdmin(user);
  const [statusFilter, setStatusFilter] = useState(IDENTITY_STATUS.PENDING);
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!authorized) return;
    setLoading(true);
    setError('');
    try {
      const rows = await IdentityVerificationService.adminListSubmissions(statusFilter);
      const withNames = await Promise.all(rows.map(async (row) => {
        try {
          const profile = await ProfileService.getPublicProfile(row.userId);
          return { ...row, fullName: profile?.fullName };
        } catch {
          return row;
        }
      }));
      setSubmissions(withNames);
    } catch (cause) {
      setError(cause.message || 'Submissions could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [authorized, statusFilter]);

  useEffect(() => { load(); }, [load]);

  if (!authorized) {
    return (
      <div className="card">
        <p className="card-title">Not authorized</p>
        <p className="card-subtitle">This page is restricted to identity reviewers.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="panel-head" style={{ marginBottom: 24 }}>
        <h2>Identity verification review</h2>
        <p>Approve or reject submitted MyKad documents</p>
      </div>

      <div className="dsc-filters" role="group" aria-label="Filter by status" style={{ gap: 12, marginBottom: 28 }}>
        {STATUS_TABS.map((status) => (
          <Chip key={status} selected={statusFilter === status} onClick={() => setStatusFilter(status)}>
            {describeIdentityStatus(status)}
          </Chip>
        ))}
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}
      {loading && <p className="card-subtitle">Loading…</p>}
      {!loading && submissions.length === 0 && <p className="card-subtitle">Nothing here.</p>}

      {submissions.map((submission) => (
        <SubmissionCard key={submission.userId} submission={submission} onReviewed={load} />
      ))}
    </div>
  );
}
