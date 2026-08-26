import { useEffect, useState } from 'react';
import { TrustedFamilyService } from '../../../business-logic/TrustedFamilyService.js';
import { IconCheckCircle, IconShield, IconTrash, IconUsers } from '../icons.jsx';
import AdaptiveDialog from '../ui/AdaptiveDialog.jsx';
import { Button } from '../ui/Button.jsx';

export default function TrustedFamilyCard() {
  const [members, setMembers] = useState([]);
  const [inviteUrl, setInviteUrl] = useState('');
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState(null);

  async function refresh() {
    try {
      setMembers(await TrustedFamilyService.listTrustedFamily());
    } catch (error) {
      setStatus({ type: 'error', text: error.message });
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function createInvite() {
    setBusy(true);
    setStatus(null);
    try {
      const result = await TrustedFamilyService.createInvite();
      const url = `${window.location.origin}/family/invite#token=${encodeURIComponent(result.token)}`;
      setInviteUrl(url);
      setStatus({ type: 'success', text: 'Invitation ready. It expires in 24 hours and can be used once.' });
    } catch (error) {
      setStatus({ type: 'error', text: error.message });
    } finally {
      setBusy(false);
    }
  }

  async function shareInvite() {
    if (!inviteUrl) return;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Let's Tumpang trusted family invitation", text: 'Accept my trusted family invitation for SOS alerts.', url: inviteUrl });
      } else {
        await navigator.clipboard.writeText(inviteUrl);
        setStatus({ type: 'success', text: 'Invitation copied.' });
      }
    } catch (error) {
      if (error?.name !== 'AbortError') setStatus({ type: 'error', text: 'Could not share the invitation. Copy it manually instead.' });
    }
  }

  async function revoke() {
    if (!revokeTarget) return;
    setBusy(true);
    try {
      await TrustedFamilyService.revokeRelationship(revokeTarget.relationshipId);
      setRevokeTarget(null);
      await refresh();
      setStatus({ type: 'success', text: 'Trusted family access revoked.' });
    } catch (error) {
      setStatus({ type: 'error', text: error.message });
    } finally {
      setBusy(false);
    }
  }

  return <div className="card trusted-family-card">
    <p className="card-title"><IconShield size={14} aria-hidden="true" /> Trusted family</p>
    <p className="card-subtitle">These people receive your SOS alerts. They cannot see your location at other times, and trust is one-way.</p>
    {status && <div className={`alert ${status.type === 'error' ? 'alert-error' : 'alert-success'}`} role={status.type === 'error' ? 'alert' : 'status'}>{status.text}</div>}
    {members.length ? <ul className="trusted-family-list">
      {members.map((member) => <li key={member.relationshipId}>
        <span className="trusted-family-avatar">{member.profilePhotoUrl ? <img src={member.profilePhotoUrl} alt="" /> : <IconUsers size={18} aria-hidden="true" />}</span>
        <span><strong>{member.name}</strong><small>{member.pushReady ? <><IconCheckCircle size={12} aria-hidden="true" /> Device alerts ready</> : 'Web Push is not enabled on their device'}</small></span>
        <button type="button" className="ui-icon-button ui-icon-button--ghost ui-icon-button--medium" aria-label={`Revoke ${member.name}`} onClick={() => setRevokeTarget(member)}><IconTrash size={16} aria-hidden="true" /></button>
      </li>)}
    </ul> : <p className="trusted-family-empty">No trusted family added yet. SOS can still be activated, but nobody will receive a family alert.</p>}
    <Button variant="secondary" loading={busy} loadingLabel="Creating invitation" onClick={createInvite}>Create one-time invitation</Button>
    {inviteUrl && <div className="family-share-result"><label htmlFor="trusted-family-invite">Invitation link</label><input id="trusted-family-invite" readOnly value={inviteUrl} onFocus={(event) => event.currentTarget.select()} /><Button variant="ghost" onClick={shareInvite}>Share or copy</Button></div>}
    <AdaptiveDialog open={Boolean(revokeTarget)} onClose={() => setRevokeTarget(null)} title="Revoke trusted family access?" description={revokeTarget ? `${revokeTarget.name} will stop receiving future SOS alerts and immediately lose any active SOS location access.` : ''} footer={<Button variant="danger" loading={busy} onClick={revoke}>Revoke access</Button>}>
      <p>This does not remove their account or affect ordinary Ride sharing links.</p>
    </AdaptiveDialog>
  </div>;
}
