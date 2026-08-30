import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext.jsx';
import { TumpangGuideService } from '../../../business-logic/guide/TumpangGuideService.js';
import { Button } from '../ui/Button.jsx';
import { AsyncState, PageHeader, PageShell } from '../ui/Primitives.jsx';
import { IconArrowLeft, IconClock, IconTrash } from '../icons.jsx';
import { getInitialGuideLanguage, guideCopy, normalizeGuideLanguage } from '../../../business-logic/guide/GuideLanguage.js';
import { GUIDE_CORE_LANGUAGES } from '../../../business-logic/guide/constants.js';

export default function GuidePastPlans() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const language = getInitialGuideLanguage();
  const [languagePack, setLanguagePack] = useState(null);
  const copy = guideCopy(language, languagePack);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(Boolean(user));
  const [error, setError] = useState('');
  useEffect(() => {
    const normalized = normalizeGuideLanguage(language);
    if (GUIDE_CORE_LANGUAGES.includes(normalized)) { setLanguagePack(null); return undefined; }
    let active = true;
    TumpangGuideService.getLanguagePack(normalized).then((pack) => { if (active) setLanguagePack(pack); }).catch(() => { if (active) setLanguagePack(null); });
    return () => { active = false; };
  }, [language]);
  const reload = async () => {
    if (!user?.id) { setSessions([]); setLoading(false); return; }
    setLoading(true); setError('');
    const cached = TumpangGuideService.listCachedSessions(user.id);
    try {
      const live = await TumpangGuideService.listSessions(user.id);
      const byId = new Map(live.map((session) => [session.id, session]));
      // A just-created conversation can be visible locally before the Edge
      // persistence request finishes. Keep it clickable instead of making the
      // Past plans screen look empty during that short window.
      cached.forEach((session) => { if (!byId.has(session.id)) byId.set(session.id, session); });
      setSessions([...byId.values()].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)));
    } catch {
      if (cached.length) setSessions(cached);
      else setError(copy.plansUnavailable);
    }
    finally { setLoading(false); }
  };
  useEffect(() => { reload(); }, [user?.id]);

  if (!user) return <PageShell className="guide-page"><AsyncState title={copy.accountRequiredTitle} action={<Button onClick={() => navigate('/auth', { state: { from: '/assistant/history', reason: 'Sign in to view your private Tumpang Guide plans.' } })}>{copy.signIn}</Button>}><p>{copy.guestNotSaved}</p></AsyncState></PageShell>;

  const remove = async (id) => { await TumpangGuideService.deleteSession(user.id, id); TumpangGuideService.removeCachedSession(user.id, id); await reload(); };
  const removeAll = async () => { await TumpangGuideService.deleteAll(user.id); TumpangGuideService.clearCachedSessions(user.id); setSessions([]); };
  return (
    <PageShell className="guide-page">
      <Link className="guide-back" to="/assistant"><IconArrowLeft size={16} /> {copy.backToGuide}</Link>
      <PageHeader title={copy.pastPlans} eyebrow={copy.privateRetention} actions={sessions.length ? <Button variant="danger" size="small" onClick={removeAll}><IconTrash size={15} /> {copy.deleteAll}</Button> : null}>{copy.savedPlanDescription}</PageHeader>
      {loading ? <AsyncState title={copy.loadingPlans} /> : (error ? <AsyncState title={copy.plansUnavailable} action={<Button onClick={reload}>{copy.retry}</Button>}><p>{error}</p></AsyncState> : (sessions.length === 0 ? <AsyncState title={copy.noSavedPlans}><p>{copy.noSavedPlansDescription}</p></AsyncState> : <div className="guide-history-list">{sessions.map((session) => <article key={session.id} className="guide-history-item"><Link className="guide-history-item__main" to={`/assistant/session/${session.id}`}><h2>{session.title}</h2><p><IconClock size={14} /> {new Date(session.updatedAt).toLocaleString(language)}</p><p>{session.planState?.startDate || copy.dateNotDecided} · {session.planState?.origin?.label || copy.originNotDecided}</p><span>{copy.openConversation}</span></Link><Button variant="danger" size="small" onClick={() => remove(session.id)}>{copy.delete}</Button></article>)}</div>))}
    </PageShell>
  );
}
