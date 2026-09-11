// Shared account-level identity form: passenger IC/Passport or driver documents.
import { useId, useRef, useState } from 'react';
import {
  describeIdentityStatus, IdentityVerificationService, validateIdentityDocument
} from '../../../business-logic/m1-profile/IdentityVerificationService.js';
import { isDriverLicenseCurrent, isOldEnoughToDrive, validateMalaysianIC } from '../../../business-logic/m1-profile/malaysianIdentity.js';
import { normalizeIdentityNumber, validatePassengerIdentityNumber } from '../../../business-logic/m1-profile/passengerIdentity.js';

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
  const [documentType, setDocumentType] = useState(driver ? 'mykad' : state?.documentType || 'mykad');
  const [passportNumber, setPassportNumber] = useState(state?.documentType === 'passport' ? state.documentNumber || '' : '');
  const documentNumber = documentType === 'passport' ? passportNumber : icNumber;
  const documentLabel = documentType === 'passport' ? 'Passport' : 'MyKad';
  const sameDocument = documentType === (state?.documentType || 'mykad')
    && normalizeIdentityNumber(documentType, documentNumber) === normalizeIdentityNumber(documentType, state?.documentNumber ?? state?.icNumber);
  const existingPhoto = sameDocument ? state?.documentPath : '';
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
    if (!driver && !validatePassengerIdentityNumber(documentType, documentNumber)) invalid.ic = documentType === 'passport'
      ? 'Enter 5–20 letters or numbers for your passport number.' : 'Enter your 12-digit IC number.';
    else if (driver && !validateMalaysianIC(icNumber)) invalid.ic = 'Enter a valid MyKad number as printed on your card.';
    else if (driver && !isOldEnoughToDrive(icNumber)) invalid.ic = 'You must be at least 17 to host.';
    for (const [key, photo, previous, label] of [
      ['icPhoto', file, existingPhoto, documentLabel],
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
      const next = await IdentityVerificationService.submit(userId, { file, licenseFile, icNumber, documentType, documentNumber, licenseExpiry, mode });
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
      <input key={key === 'icPhoto' ? documentType : key} id={`${id}-${key}`} type="file" accept="image/jpeg,image/png,image/webp"
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
      : 'Choose IC or Passport, enter its number and upload one clear photo to request rides or contact other members. No driving licence or vehicle is needed.'}</p>
    <p>Status: {describeIdentityStatus(state?.status)}</p>
    {state?.reviewNote && <p role="alert">Reviewer note: {state.reviewNote}</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <div role="alert" className="alert alert-error">{error}</div>}
    {open ? <form onSubmit={handleSubmit} noValidate>
      {Object.keys(errors).length > 0 && <div ref={errorRef} tabIndex={-1} role="alert" className="alert alert-error">Please correct the highlighted document fields.</div>}
      <fieldset disabled={saving} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        {!driver && <div className="field">
          <label htmlFor={`${id}-type`}>Identity document</label>
          <div className="input-wrap"><select id={`${id}-type`} value={documentType} onChange={(event) => {
            setDocumentType(event.target.value); setFile(null); setErrors({}); setError(''); setNotice('');
          }}>
            <option value="mykad">IC / MyKad</option>
            <option value="passport">Passport</option>
          </select></div>
        </div>}
        <div className="field">
          <label htmlFor={`${id}-ic`}>{documentLabel} number (required)</label>
          <div className="input-wrap"><input id={`${id}-ic`} value={documentNumber} inputMode={documentType === 'passport' ? 'text' : 'numeric'} autoComplete="off"
            aria-invalid={Boolean(errors.ic)} aria-describedby={errors.ic ? `${id}-ic-error` : undefined}
            onChange={(event) => { (documentType === 'passport' ? setPassportNumber : setIcNumber)(event.target.value); clearFieldError('ic'); }} /></div>
          {!driver && <p className="card-subtitle">{documentType === 'passport' ? '5–20 letters or numbers, as printed on your passport.' : '12 digits. Spaces and dashes are allowed.'}</p>}
          {fieldError('ic')}
        </div>
        {state?.documentPath && !sameDocument && <p className="card-subtitle">Upload a matching photo when changing the document type or number.</p>}
        {!driver && documentType === 'passport' && state?.licenseDocumentPath && <p className="card-subtitle">Passport is for passenger use. To host again, submit your MyKad in My Vehicles. Your driving licence files are kept.</p>}
        {photoField('icPhoto', `${documentLabel} photo`, existingPhoto, setFile)}
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
        <button className="btn-primary" disabled={saving}>{saving ? 'Submitting…' : driver ? 'Save driver documents' : 'Submit identity document'}</button>
        {onCancel && <button type="button" className="btn-secondary" style={{ minHeight: 44, marginTop: 8 }} onClick={onCancel}>Cancel</button>}
      </fieldset>
    </form> : <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>Update my documents</button>}
  </section>;
}
