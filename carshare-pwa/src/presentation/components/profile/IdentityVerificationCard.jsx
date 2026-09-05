// ===== PRESENTATION LAYER (IdentityVerificationCard) =====
// The MyKad is entered once, here: photo, number and licence expiry together.
// Vehicles no longer ask for a licence, so a Host with three cars fills this in
// once rather than three times.
//
// Rendered in two places from one component - as the blocking gate in front of
// Publish, and as the status card in Profile > Info & Security - so the two can
// never describe the same state differently.
import { useState } from 'react';
import {
  describeIdentityStatus,
  identityLicenseHasLapsed,
  IDENTITY_STATUS,
  IdentityVerificationService
} from '../../../business-logic/IdentityVerificationService.js';
import { IconShield, IconCheck } from '../icons.jsx';

const STATUS_TONE = {
  [IDENTITY_STATUS.APPROVED]: 'reputation-standing-trusted',
  [IDENTITY_STATUS.PENDING]: 'reputation-standing-standard',
  [IDENTITY_STATUS.REJECTED]: 'reputation-standing-restricted',
  [IDENTITY_STATUS.NONE]: 'reputation-standing-new'
};

export default function IdentityVerificationCard({ userId, state, onSubmitted, compact = false }) {
  const status = state?.status || IDENTITY_STATUS.NONE;
  const lapsed = identityLicenseHasLapsed(state);
  const submitted = status === IDENTITY_STATUS.PENDING || status === IDENTITY_STATUS.APPROVED;

  const [open, setOpen] = useState(!compact);
  const [file, setFile] = useState(null);
  const [icNumber, setIcNumber] = useState(state?.icNumber || '');
  const [licenseExpiry, setLicenseExpiry] = useState(state?.licenseExpiry || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      const next = await IdentityVerificationService.submit(userId, { file, icNumber, licenseExpiry });
      onSubmitted?.(next);
      setFile(null);
      if (compact) setOpen(false);
    } catch (submitError) {
      setError(submitError.message || 'That photo could not be uploaded.');
    } finally {
      setSaving(false);
    }
  }

  const form = (
    <form onSubmit={handleSubmit}>
      <div className="field">
        <label htmlFor="identity-ic-number">MyKad number</label>
        <div className="input-wrap">
          <input
            id="identity-ic-number"
            value={icNumber}
            onChange={(event) => { setIcNumber(event.target.value); setError(''); }}
            placeholder="990101-14-5678"
            inputMode="numeric"
            autoComplete="off"
            required
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="identity-license-expiry">
          Driver&apos;s licence expiry <span className="hint">your licence carries this same MyKad number</span>
        </label>
        <div className="input-wrap">
          <input
            id="identity-license-expiry"
            type="date"
            value={licenseExpiry}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(event) => { setLicenseExpiry(event.target.value); setError(''); }}
            required
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="identity-document">Photo of your MyKad</label>
        <div className="input-wrap">
          <input
            id="identity-document"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            onChange={(event) => { setFile(event.target.files?.[0] || null); setError(''); }}
            required
          />
        </div>
        <p className="card-subtitle" style={{ marginBottom: 0 }}>JPEG, PNG or WebP, up to 5 MB.</p>
      </div>
      <button className="btn-primary" disabled={saving || !file}>
        {saving ? 'Uploading…' : submitted ? 'Replace my document' : 'Submit for review'}
      </button>
    </form>
  );

  if (compact) {
    return (
      <div className="card">
        <p className="card-title">Identity verification</p>
        <p className="card-subtitle">Required once before you can host. Riding as a passenger never needs it.</p>

        <div className={`reputation-standing ${STATUS_TONE[status] || ''}`}>{describeIdentityStatus(status)}</div>

        {submitted && (
          <ul className="reputation-rules">
            {state?.icNumber && <li>MyKad {state.icNumber}</li>}
            {state?.licenseExpiry && (
              <li>Licence expires {new Date(state.licenseExpiry).toLocaleDateString('en-MY')}{lapsed ? ' — expired' : ''}</li>
            )}
            {state?.submittedAt && <li>Submitted {new Date(state.submittedAt).toLocaleDateString('en-MY')}</li>}
          </ul>
        )}

        {lapsed && (
          <div className="alert alert-error">
            Your licence has lapsed, so publishing is paused. Submit a renewed expiry date to host again.
          </div>
        )}
        {status === IDENTITY_STATUS.REJECTED && state?.reviewNote && (
          <div className="alert alert-error">Reviewer note: {state.reviewNote}</div>
        )}
        {error && <div className="alert alert-error">{error}</div>}

        {open ? form : (
          <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>
            {submitted ? 'Update my details' : 'Verify my identity'}
          </button>
        )}
      </div>
    );
  }

  return (
    <section className="publish-access-card" aria-labelledby="identity-gate-heading">
      <span className="publish-access-icon"><IconShield size={24} /></span>
      <h1 id="identity-gate-heading">
        {lapsed ? 'Your driver’s licence has expired' : status === IDENTITY_STATUS.REJECTED
          ? 'Upload a clearer photo of your MyKad'
          : 'Verify your identity to host'}
      </h1>
      <p>
        Passengers travel with a stranger on the strength of this check, so your MyKad is required
        once before you can publish a ride. Riding as a passenger never needs one, and your vehicles
        will not ask for it again.
      </p>

      <ul className="perk-list" style={{ textAlign: 'left' }}>
        <li><span className="perk-check"><IconCheck size={12} /></span>Stored privately &mdash; only you and a reviewer can open it</li>
        <li><span className="perk-check"><IconCheck size={12} /></span>Never shown on your public profile or on a ride card</li>
        <li><span className="perk-check"><IconCheck size={12} /></span>You can publish as soon as it is uploaded</li>
      </ul>

      {status === IDENTITY_STATUS.REJECTED && state?.reviewNote && (
        <div className="alert alert-error">Reviewer note: {state.reviewNote}</div>
      )}
      {error && <div className="alert alert-error">{error}</div>}

      {form}

      <p className="card-subtitle" style={{ marginBottom: 0 }}>
        Current status: {describeIdentityStatus(status)}.
      </p>
    </section>
  );
}
