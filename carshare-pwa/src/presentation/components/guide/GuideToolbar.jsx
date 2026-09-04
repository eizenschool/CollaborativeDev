// ===== PRESENTATION LAYER (GuideToolbar) =====
// Brand, language-loading state, "New chat" and "Past plans". The former
// "Your travel brief" toggle lived here too; it is gone along with the
// sidebar it opened - see GuideContextBar.jsx.
import { Link } from 'react-router-dom';
import { Button } from '../ui/Button.jsx';
import { IconArrowRight, IconRoute } from '../icons.jsx';

export default function GuideToolbar({ hasConversation, languageBusy, copy, onNewChat }) {
  return (
    <div className={`guide-toolbar ${hasConversation ? 'is-active-chat' : ''}`}>
      <div className="guide-toolbar__brand">
        <span className="guide-trip-badge"><IconRoute size={18} /></span>
        <strong>Tumpang Guide</strong>
      </div>
      {languageBusy && <span className="guide-language-loading">{copy.loadingLanguage}</span>}
      <Button type="button" size="small" variant="secondary" onClick={onNewChat}>{copy.newChat}</Button>
      <Link to="/assistant/history">{copy.pastPlans} <IconArrowRight size={14} /></Link>
    </div>
  );
}
