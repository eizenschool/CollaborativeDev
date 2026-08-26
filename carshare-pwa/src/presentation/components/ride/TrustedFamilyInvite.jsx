import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TrustedFamilyService } from '../../../business-logic/TrustedFamilyService.js';
import { IconCheckCircle, IconShield } from '../icons.jsx';
import { Button } from '../ui/Button.jsx';

const STORAGE_KEY = 'm2-trusted-family-invite-token';

export default function TrustedFamilyInvite() {
  const navigate = useNavigate();
  const [token] = useState(() => {
    const fromHash = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('token');
    if (fromHash) sessionStorage.setItem(STORAGE_KEY, fromHash);
    return fromHash || sessionStorage.getItem(STORAGE_KEY) || '';
  });
  const [state, setState] = useState('ready');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (window.location.hash) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  }, []);

  async function accept() {
    if (!token) return;
    setState('busy');
    setMessage('');
    try {
      const result = await TrustedFamilyService.acceptInvite(token);
      sessionStorage.removeItem(STORAGE_KEY);
      setMessage(`You are now trusted family for ${result.ownerName}. You will only receive location access during their active SOS.`);
      setState('accepted');
    } catch (error) {
      sessionStorage.removeItem(STORAGE_KEY);
      setMessage(error.message);
      setState('error');
    }
  }

  function cancel() {
    sessionStorage.removeItem(STORAGE_KEY);
    navigate('/home', { replace: true });
  }

  return <main className="phone-ride-page ride-detail-page family-invite-page"><div className="ride-detail-content"><section className="ride-info-card invite-accept-card">
    <span className="invite-shield" aria-hidden="true"><IconShield size={28} /></span>
    <p className="eyebrow">TRUSTED FAMILY INVITATION</p>
    <h1>{state === 'accepted' ? 'Invitation accepted' : 'Receive SOS alerts'}</h1>
    <p>Accepting creates a one-way relationship. You cannot track this person normally; location is available only while they have an active SOS.</p>
    {!token && <div className="alert alert-error" role="alert">This invitation is missing or no longer available.</div>}
    {message && <div className={`alert ${state === 'error' ? 'alert-error' : 'alert-success'}`} role={state === 'error' ? 'alert' : 'status'}>{state === 'accepted' && <IconCheckCircle size={16} aria-hidden="true" />} {message}</div>}
    {state === 'ready' && <div className="invite-actions"><Button disabled={!token} onClick={accept}>Accept invitation</Button><Button variant="ghost" onClick={cancel}>Cancel</Button></div>}
    {state === 'busy' && <Button loading loadingLabel="Accepting invitation">Accept invitation</Button>}
    {['accepted', 'error'].includes(state) && <Button variant="secondary" onClick={() => navigate('/home', { replace: true })}>Continue</Button>}
  </section></div></main>;
}
