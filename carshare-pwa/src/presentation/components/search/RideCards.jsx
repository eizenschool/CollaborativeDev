import { MapPin, Clock, Star, Users, ChevronRight, Route, ArrowRight, Leaf } from 'lucide-react'

export function StatusBadge({ status }) {
  const cfg = {
    Available:       { bg: '#DCFCE7', text: '#15803D' },
    Full:            { bg: '#F3F4F6', text: '#9CA3AF' },
    'Departing soon':{ bg: '#FEF9C3', text: '#92400E' },
  }[status]
  return (
    <span className="px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap flex-shrink-0"
      style={{ backgroundColor: cfg.bg, color: cfg.text }}>
      {status}
    </span>
  )
}

export function StarToggle({ isFav, onToggle }) {
  return (
    <button onClick={e => { e.stopPropagation(); onToggle() }}
      className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 transition-all active:scale-90"
      style={{ backgroundColor: isFav ? '#FEF9C3' : '#F9FAFB', border: `1.5px solid ${isFav ? '#F59E0B' : '#E5E7EB'}` }}
      title={isFav ? 'Remove from favourites' : 'Save to favourites'}>
      <Star size={13} fill={isFav ? '#F59E0B' : 'none'} style={{ color: isFav ? '#F59E0B' : '#D1D5DB' }} />
    </button>
  )
}

export function TierDot({ tier }) {
  const c = { Bronze: '#CD7F32', Silver: '#9CA3AF', Gold: '#F59E0B' }[tier]
  return <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: c }} />
}

export function RideCard({ ride, isFav, onToggleFav, onView }) {
  const isUnavailable = ride.status === 'Full'
  return (
    <div className="bg-white rounded-2xl overflow-hidden transition-shadow hover:shadow-md"
      style={{ border: '1px solid #E5E7EB', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', opacity: isUnavailable ? 0.7 : 1 }}>
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <MapPin size={12} style={{ color: '#16A34A', flexShrink: 0 }} />
              <p className="text-sm font-bold truncate" style={{ color: '#111827', fontFamily: "'Poppins', sans-serif" }}>
                {ride.from.split(',')[0]}
              </p>
            </div>
            <div className="flex items-center gap-1.5 pl-[18px]">
              <div className="w-px h-3 rounded" style={{ backgroundColor: '#D1D5DB' }} />
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <MapPin size={12} style={{ color: '#EF4444', flexShrink: 0 }} />
              <p className="text-sm font-bold truncate" style={{ color: '#111827', fontFamily: "'Poppins', sans-serif" }}>
                {ride.to.split(',')[0]}
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2 flex-shrink-0">
            <StatusBadge status={ride.status} />
            <StarToggle isFav={isFav} onToggle={onToggleFav} />
          </div>
        </div>

        <div className="flex items-center gap-3 mb-3 px-1">
          <div className="flex items-center gap-1">
            <Clock size={11} style={{ color: '#9CA3AF' }} />
            <span className="text-xs font-semibold" style={{ color: '#374151' }}>{ride.departTime}</span>
          </div>
          <div className="flex-1 flex items-center gap-1">
            <div className="flex-1 h-px" style={{ backgroundColor: '#E5E7EB' }} />
            <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: '#F9FAFB', color: '#6B7280', border: '1px solid #E5E7EB' }}>
              {ride.durationLabel}
            </span>
            <div className="flex-1 h-px" style={{ backgroundColor: '#E5E7EB' }} />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs font-semibold" style={{ color: '#374151' }}>{ride.arrivalTime}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-3">
          <img src={ride.host.avatar} alt={ride.host.name} className="w-6 h-6 rounded-full object-cover flex-shrink-0" style={{ backgroundColor: '#E5E7EB' }} />
          <TierDot tier={ride.host.tier} />
          <span className="text-xs font-medium" style={{ color: '#374151' }}>{ride.host.name}</span>
          <span className="ml-auto flex items-center gap-0.5 text-xs" style={{ color: '#F59E0B' }}>
            <Star size={10} fill="#F59E0B" />
            <span style={{ color: '#374151', fontWeight: 600 }}>{ride.host.score}</span>
          </span>
          <span className="flex items-center gap-1 text-xs" style={{ color: '#9CA3AF' }}>
            <Users size={10} />
            {ride.seats}
          </span>
        </div>

        {ride.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {ride.tags.slice(0, 3).map(t => (
              <span key={t} className="px-2 py-0.5 rounded-full text-xs" style={{ backgroundColor: '#F3F4F6', color: '#6B7280' }}>
                {t === 'Pet-friendly' ? '🐾 ' : t === 'Women-only' ? '👩 ' : ''}{t}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="px-4 py-2.5 flex items-center justify-between" style={{ borderTop: '1px solid #F3F4F6', backgroundColor: '#FAFAFA' }}>
        <span className="text-xs" style={{ color: '#9CA3AF' }}>{ride.scale} · {ride.contribution}</span>
        <button onClick={onView}
          className="flex items-center gap-1 text-xs font-semibold transition-colors hover:opacity-80"
          style={{ color: '#16A34A' }}>
          View Details <ChevronRight size={13} />
        </button>
      </div>
    </div>
  )
}

export function MultiLegCard({ ride, isFav, onToggleFav }) {
  return (
    <div className="bg-white rounded-2xl overflow-hidden"
      style={{ border: '1.5px solid #A7F3D0', boxShadow: '0 4px 16px rgba(22,163,74,0.08)' }}>
      <div className="px-4 py-2.5 flex items-center justify-between" style={{ backgroundColor: '#F0FDF4', borderBottom: '1px solid #DCFCE7' }}>
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-md flex items-center justify-center" style={{ backgroundColor: '#16A34A' }}>
            <Route size={11} color="white" />
          </div>
          <span className="text-xs font-bold" style={{ color: '#15803D', fontFamily: "'Poppins', sans-serif" }}>
            Alternative Route · 2 legs
          </span>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status="Available" />
          <StarToggle isFav={isFav} onToggle={onToggleFav} />
        </div>
      </div>

      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center gap-2 mb-3">
          <p className="text-sm font-bold" style={{ color: '#111827', fontFamily: "'Poppins', sans-serif" }}>
            {ride.from}
          </p>
          <ArrowRight size={14} style={{ color: '#9CA3AF', flexShrink: 0 }} />
          <p className="text-sm font-bold" style={{ color: '#111827', fontFamily: "'Poppins', sans-serif" }}>
            {ride.to}
          </p>
          <span className="ml-auto text-xs px-2 py-0.5 rounded-full font-semibold flex-shrink-0"
            style={{ backgroundColor: '#F9FAFB', color: '#6B7280', border: '1px solid #E5E7EB' }}>
            {ride.totalDuration}
          </span>
        </div>

        <div className="relative mb-1">
          <div className="flex items-stretch gap-3">
            <div className="flex flex-col items-center pt-1 flex-shrink-0">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#16A34A', border: '2px solid white', boxShadow: '0 0 0 1.5px #16A34A' }} />
              <div className="w-px flex-1 my-0.5" style={{ backgroundColor: '#DCFCE7', minHeight: 24 }} />
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#F59E0B', border: '2px solid white', boxShadow: '0 0 0 1.5px #F59E0B' }} />
            </div>
            <div className="flex-1 min-w-0 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold" style={{ color: '#374151' }}>{ride.leg1.from}</span>
                <span className="text-xs font-bold" style={{ color: '#16A34A' }}>{ride.leg1.time}</span>
              </div>
              <div className="flex items-center gap-2 px-2">
                <div className="flex-1 h-px" style={{ backgroundColor: '#E5E7EB' }} />
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg"
                  style={{ backgroundColor: '#F9FAFB', border: '1px solid #E5E7EB' }}>
                  <img src={ride.leg1.host.avatar} alt="" className="w-4 h-4 rounded-full object-cover" />
                  <span className="text-xs" style={{ color: '#6B7280' }}>{ride.leg1.host.name.split(' ')[0]} · {ride.leg1.duration}</span>
                </div>
                <div className="flex-1 h-px" style={{ backgroundColor: '#E5E7EB' }} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold" style={{ color: '#374151' }}>{ride.leg1.to}</span>
                <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                  style={{ backgroundColor: '#FFFBEB', color: '#92400E' }}>
                  Transfer
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="ml-4 my-1.5 flex items-center gap-2 py-1.5 px-3 rounded-lg" style={{ backgroundColor: '#FFFBEB', border: '1px solid #FDE68A' }}>
          <Clock size={11} style={{ color: '#F59E0B' }} />
          <span className="text-xs font-semibold" style={{ color: '#92400E' }}>Transfer · {ride.transferAt} · ~15 min wait</span>
        </div>

        <div className="mt-1">
          <div className="flex items-stretch gap-3">
            <div className="flex flex-col items-center pt-1 flex-shrink-0">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#F59E0B', border: '2px solid white', boxShadow: '0 0 0 1.5px #F59E0B' }} />
              <div className="w-px flex-1 my-0.5" style={{ backgroundColor: '#FECACA', minHeight: 24 }} />
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#EF4444', border: '2px solid white', boxShadow: '0 0 0 1.5px #EF4444' }} />
            </div>
            <div className="flex-1 min-w-0 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold" style={{ color: '#374151' }}>{ride.leg2.from}</span>
                <span className="text-xs font-bold" style={{ color: '#16A34A' }}>{ride.leg2.time}</span>
              </div>
              <div className="flex items-center gap-2 px-2">
                <div className="flex-1 h-px" style={{ backgroundColor: '#E5E7EB' }} />
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg"
                  style={{ backgroundColor: '#F9FAFB', border: '1px solid #E5E7EB' }}>
                  <img src={ride.leg2.host.avatar} alt="" className="w-4 h-4 rounded-full object-cover" />
                  <span className="text-xs" style={{ color: '#6B7280' }}>{ride.leg2.host.name.split(' ')[0]} · {ride.leg2.duration}</span>
                </div>
                <div className="flex-1 h-px" style={{ backgroundColor: '#E5E7EB' }} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold" style={{ color: '#374151' }}>{ride.leg2.to}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 py-2.5 flex items-center justify-between mt-1" style={{ borderTop: '1px solid #F3F4F6', backgroundColor: '#FAFAFA' }}>
        <div className="flex items-center gap-1.5">
          <Leaf size={11} style={{ color: '#0D9488' }} />
          <span className="text-xs font-medium" style={{ color: '#0D9488' }}>Auto-matched route · {ride.date}</span>
        </div>
        <button className="flex items-center gap-1 text-xs font-semibold" style={{ color: '#16A34A' }}>
          View Details <ChevronRight size={13} />
        </button>
      </div>
    </div>
  )
}