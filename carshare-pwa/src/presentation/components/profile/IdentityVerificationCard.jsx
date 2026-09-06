// Shared account-level identity form: passenger IC or driver documents.
import { useId, useRef, useState } from 'react';
import {
  describeIdentityStatus, IdentityVerificationService, validateIdentityDocument
} from '../../../business-logic/IdentityVerificationService.js';
import { isDriverLicenseCurrent, isOldEnoughToDrive, validateMalaysianIC } from '../../../business-logic/malaysianIdentity.js';

export function IdentityDocumentPreview({ path, label }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function preview() {
    setBusy(true);
    setError('');
    try {
      const signed = await IdentityVerificationService.previewUrl(path);
      if (!signed) throw new Error('Preview is unavailable in this environment.');
      setUrl(signed);
    } catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }
  if (!path) return <p className="card-subtitle">{label}: not submitted.</p>;
  return <div style={{ marginBottom: 16 }}>
    <button type="button" className="btn-secondary" disabled={busy} onClick={preview}>
      {busy ? 'Opening…' : `View ${label}`}
    </button>
    {url && <img src={url} alt={label} style={{ display: 'block', maxWidth: '100%', maxHeight: 360, marginTop: 12, objectFit: 'contain' }}
      onError={() => { setUrl(''); setError('Preview expired. Select View to open it again.'); }} />}
    {error && <p role="alert">{error}</p>}
  </div>;
}

export default function IdentityVerificationCard({ userId, state, onSubmitted, compact = false, mode = 'passenger', onCancel }) {
  const driver = mode === 'driver';
  const id = useId();
  const errorRef = useRef(null);
  const [open, setOpen] = useState(!compact);
  const [file, setFile] = useState(null);
  const [licenseFile, setLicenseFile] = useState(null);
  const [icNumber, setIcNumber] = useState(state?.icNumber || '');
  const [licenseExpiry, setLicenseExpiry] = useState(state?.licenseExpiry || '');
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  function clearFieldError(key) {
    setErrors((current) => { const next = { ...current }; delete next[key]; return next; });
    setError('');
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (saving) return;
    const invalid = {};
    if (!validateMalaysianIC(icNumber)) invalid.ic = 'Enter a valid MyKad number as printed on your card.';
    else if (driver && !isOldEnoughToDrive(icNumber)) invalid.ic = 'You must be at least 17 to host.';
    for (const [key, photo, previous, label] of [
      ['icPhoto', file, state?.documentPath, 'MyKad'],
      ...(driver ? [['licencePhoto', licenseFile, state?.licenseDocumentPath, 'driving licence']] : [])
    ]) {
      if (!photo && previous) continue;
      try { validateIdentityDocument(photo); }
      catch (cause) { invalid[key] = photo ? cause.message : `Choose a photo of your ${label}.`; }
    }
    if (driver && !isDriverLicenseCurrent(licenseExpiry)) invalid.expiry = 'Enter a driving licence expiry date that has not passed.';
    setErrors(invalid);
    setError('');
    setNotice('');
    if (Object.keys(invalid).length) {
      requestAnimationFrame(() => errorRef.current?.focus());
      return;
    }
    setSaving(true);
    try {
      const next = await IdentityVerificationService.submit(userId, { file, licenseFile, icNumber, licenseExpiry, mode });
      setFile(null);
      setLicenseFile(null);
      setNotice('Documents submitted. Awaiting review.');
      onSubmitted?.(next);
      if (compact) setOpen(false);
    } catch (cause) { setError(cause.message || 'Submission could not be confirmed. Please try again.'); }
    finally { setSaving(false); }
  }
  function fieldError(key) {
    return errors[key] && <p id={`${id}-${key}-error`} role="alert" style={{ color: 'var(--danger)' }}>{errors[key]}</p>;
  }
  function photoField(key, label, existing, setter) {
    return <div className="field">
      <label htmlFor={`${id}-${key}`}>{label}{existing ? ' (optional replacement)' : ' (required)'}</label>
      <input id={`${id}-${key}`} type="file" accept="image/jpeg,image/png,image/webp"
        style={{ maxWidth: '100%', width: '100%' }}
        aria-invalid={Boolean(errors[key])} aria-describedby={errors[key] ? `${id}-${key}-error` : undefined}
        onChange={(event) => { setter(event.target.files?.[0] || null); clearFieldError(key); }} />
      <p className="card-subtitle">JPEG, PNG or WebP, up to 5 MB per photo.</p>
      {fieldError(key)}
      <IdentityDocumentPreview key={existing || key} path={existing} label={label} />
    </div>;
  }
  return <section className="card" aria-label={driver ? 'Driver documents' : 'Identity verification'}>
    <h2>{driver ? 'Driver documents' : 'Identity verification'}</h2>
    <p className="card-subtitle">{driver
      ? 'Complete your documents once before adding a vehicle. A submitted application lets you host while awaiting review.'
      : 'Submit your MyKad to request rides or contact other members. No driving licence or vehicle is needed.'}</p>
    <p>Status: {describeIdentityStatus(state?.status)}</p>
    {state?.reviewNote && <p role="alert">Reviewer note: {state.reviewNote}</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <div role="alert" className="alert alert-error">{error}</div>}
    {open ? <form onSubmit={handleSubmit} noValidate>
      {Object.keys(errors).length > 0 && <div ref={errorRef} tabIndex={-1} role="alert" className="alert alert-error">Please correct the highlighted document fields.</div>}
      <fieldset disabled={saving} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <div className="field">
          <label htmlFor={`${id}-ic`}>MyKad number (required)</label>
          <div className="input-wrap"><input id={`${id}-ic`} value={icNumber} inputMode="numeric" autoComplete="off"
            aria-invalid={Boolean(errors.ic)} aria-describedby={errors.ic ? `${id}-ic-error` : undefined}
            onChange={(event) => { setIcNumber(event.target.value); clearFieldError('ic'); }} /></div>
          {fieldError('ic')}
        </div>
        {photoField('icPhoto', 'MyKad photo', state?.documentPath, setFile)}
        {driver && <>
          <div className="field">
            <label htmlFor={`${id}-expiry`}>Driving licence expiry (required)</label>
            <div className="input-wrap"><input id={`${id}-expiry`} type="date" value={licenseExpiry}
              aria-invalid={Boolean(errors.expiry)} aria-describedby={errors.expiry ? `${id}-expiry-error` : undefined}
              onChange={(event) => { setLicenseExpiry(event.target.value); clearFieldError('expiry'); }} /></div>
            {fieldError('expiry')}
          </div>
          {photoField('licencePhoto', 'Driving licence photo', state?.licenseDocumentPath, setLicenseFile)}
        </>}
        <p className="card-subtitle">Stored privately. Only you and an authorized reviewer can view your documents.</p>
        <button className="btn-primary" disabled={saving}>{saving ? 'Submitting…' : driver ? 'Save driver documents' : 'Submit MyKad'}</button>
        {onCancel && <button type="button" className="btn-secondary" style={{ minHeight: 44, marginTop: 8 }} onClick={onCancel}>Cancel</button>}
      </fieldset>
    </form> : <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>Update my documents</button>}
  </section>;
}
