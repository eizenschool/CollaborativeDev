// ===== PRESENTATION LAYER (AudienceSwitch) =====
// Destination Discovery answers two different questions for two different
// people: a traveller asking where to go, and a Host asking where a ride they
// publish would actually be filled.
//
// They share a catalogue and a demand signal, so they belong in one area rather
// than two. They are separate routes rather than one screen with a filter,
// because the URL should say which question is being asked - it stays meaningful
// when shared, bookmarked or reloaded.
import { useNavigate } from 'react-router-dom';
import { IconSearch, IconUsers } from '../icons.jsx';

export default function AudienceSwitch({ active, travelDate, demo }) {
  const navigate = useNavigate();

  const query = new URLSearchParams();
  if (travelDate) query.set('date', travelDate);
  if (demo) query.set('demo', '1');
  const suffix = query.toString() ? `?${query}` : '';

  const go = (path) => navigate(`${path}${suffix}`);

  return (
    <div className="dsc-audience" role="tablist" aria-label="Discovery view">
      <button
        type="button"
        role="tab"
        aria-selected={active === 'explore'}
        className={'dsc-audience-tab' + (active === 'explore' ? ' active' : '')}
        onClick={() => go('/discover')}
      >
        <IconSearch size={16} /> Where should I go?
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={active === 'demand'}
        className={'dsc-audience-tab' + (active === 'demand' ? ' active' : '')}
        onClick={() => go('/discover/demand')}
      >
        <IconUsers size={16} /> Where do people want to go?
      </button>
    </div>
  );
}
