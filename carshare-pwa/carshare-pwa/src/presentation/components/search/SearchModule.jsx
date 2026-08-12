import { useState, useMemo } from 'react'
import { SlidersHorizontal, X, Search, Star, MapPin, Clock, Dog, Route, Users } from 'lucide-react'
import SearchForm from './SearchForm'
import { RideCard, MultiLegCard, StatusBadge } from './RideCards'

const hosts = [
  { name: 'Ahmad Rizal', avatar: 'https://i.pravatar.cc/150?u=1', score: 4.9, tier: 'Gold' },
  { name: 'Sarah Tan', avatar: 'https://i.pravatar.cc/150?u=2', score: 4.7, tier: 'Silver' },
  { name: 'Raj', avatar: 'https://i.pravatar.cc/150?u=3', score: 4.8, tier: 'Bronze' },
  { name: 'Nurul', avatar: 'https://i.pravatar.cc/150?u=4', score: 4.6, tier: 'Silver' }
];

const RESULTS = [
  {
    id: 'sr1', from: 'KL Sentral, Brickfields', to: 'Georgetown, Penang',
    date: 'Sat, 21 Dec 2024', departTime: '7:00 AM', arrivalTime: '11:30 AM',
    durationLabel: '4h 30m', seats: 3, host: hosts[0],
    tags: ['Pet-friendly', 'No smoking'], status: 'Available',
    scale: 'Intercity', contribution: 'Snacks & drinks',
  },
  {
    id: 'sr2', from: 'SS2, Petaling Jaya', to: 'USJ 10, Subang Jaya',
    date: 'Mon, 23 Dec 2024', departTime: '7:30 AM', arrivalTime: '8:00 AM',
    durationLabel: '30m', seats: 2, host: hosts[1],
    tags: ['No smoking', 'Women-only'], status: 'Departing soon',
    scale: 'Urban', contribution: 'Toll contribution',
  },
  {
    id: 'sr_ml', multiLeg: true,
    from: 'KL Sentral', to: 'Georgetown, Penang',
    transferAt: 'Ipoh Old Town',
    date: 'Sat, 21 Dec 2024',
    totalDuration: '5h 15m',
    status: 'Available',
    leg1: { from: 'KL Sentral', to: 'Ipoh Old Town', time: '6:30 AM', host: hosts[2], duration: '3h' },
    leg2: { from: 'Ipoh Old Town', to: 'Georgetown, Penang', time: '9:45 AM', host: hosts[3], duration: '2h 15m' },
  },
  {
    id: 'sr3', from: 'Ampang Point', to: 'KLCC, Kuala Lumpur',
    date: 'Tue, 24 Dec 2024', departTime: '8:15 AM', arrivalTime: '8:40 AM',
    durationLabel: '25m', seats: 1, host: hosts[2],
    tags: ['No smoking'], status: 'Full',
    scale: 'Urban', contribution: 'No contribution needed',
  },
  {
    id: 'sr4', from: 'Shah Alam City Centre', to: 'Putrajaya IOI City Mall',
    date: 'Wed, 25 Dec 2024', departTime: '8:30 AM', arrivalTime: '9:15 AM',
    durationLabel: '45m', seats: 4, host: hosts[3],
    tags: ['Pet-friendly', 'No smoking', 'Child seat available'], status: 'Available',
    scale: 'Intercity', contribution: 'Hot drinks',
  },
  {
    id: 'sr5', from: 'Bangsar South, KL', to: 'Putrajaya Sentral',
    date: 'Thu, 26 Dec 2024', departTime: '9:00 AM', arrivalTime: '9:50 AM',
    durationLabel: '50m', seats: 2, host: hosts[1],
    tags: ['No smoking', 'Women-only'], status: 'Available',
    scale: 'Intercity', contribution: 'Coffee',
  },
]

const FILTERS = [
  { id: 'morning', label: 'Morning', icon: <Clock size={11} /> },
  { id: 'reputation', label: 'Top Rated', icon: <Star size={11} /> },
  { id: 'pet', label: 'Pet-Friendly', icon: <Dog size={11} /> },
  { id: 'urban', label: 'Urban Route', icon: <Route size={11} /> },
  { id: 'intercity', label: 'Intercity', icon: <MapPin size={11} /> },
  { id: 'women', label: "Women-only", icon: <Users size={11} /> },
]

function FilterChips({ active, toggle }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
      {FILTERS.map(f => {
        const on = active.has(f.id)
        return (
          <button key={f.id} onClick={() => toggle(f.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border whitespace-nowrap flex-shrink-0 transition-all"
            style={{
              backgroundColor: on ? '#16A34A' : 'white',
              color: on ? 'white' : '#374151',
              borderColor: on ? '#16A34A' : '#E5E7EB',
              boxShadow: on ? '0 2px 8px rgba(22,163,74,0.25)' : 'none',
            }}>
            <span style={{ opacity: on ? 1 : 0.6 }}>{f.icon}</span>
            {f.label}
            {on && <X size={10} />}
          </button>
        )
      })}
    </div>
  )
}

function FavouritesPanel({ favIds, results }) {
  const favs = results.filter(r => favIds.has(r.id))
  if (favs.length === 0) return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3" style={{ backgroundColor: '#FEF9C3' }}>
        <Star size={20} style={{ color: '#F59E0B' }} />
      </div>
      <p className="text-sm font-semibold" style={{ color: '#9CA3AF' }}>No favourites saved yet</p>
      <p className="text-xs mt-1" style={{ color: '#D1D5DB' }}>Tap ★ on any ride card to save it here</p>
    </div>
  )
  return (
    <div className="space-y-2">
      {favs.filter(r => !r.multiLeg).map(sr => (
        <div key={sr.id} className="flex items-center gap-3 bg-white px-3 py-2.5 rounded-xl"
          style={{ border: '1px solid #E5E7EB', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
          <Star size={14} fill="#F59E0B" style={{ color: '#F59E0B', flexShrink: 0 }} />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold truncate" style={{ color: '#111827' }}>
              {sr.from.split(',')[0]} → {sr.to.split(',')[0]}
            </p>
            <p className="text-xs" style={{ color: '#9CA3AF' }}>{sr.date} · {sr.departTime}</p>
          </div>
          <StatusBadge status={sr.status} />
        </div>
      ))}
    </div>
  )
}

export default function SearchModule() {
  const isDesktop = true; 
  const [from, setFrom] = useState('KL Sentral, Brickfields')
  const [to, setTo] = useState('')
  const [date, setDate] = useState('2024-12-21')
  const [time, setTime] = useState('07:00')
  const [searched, setSearched] = useState(true)
  const [activeFilters, setActiveFilters] = useState(new Set())
  const [favIds, setFavIds] = useState(new Set(['sr1']))
  const [sideTab, setSideTab] = useState('results')

  const toggleFilter = (id) =>
    setActiveFilters(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const toggleFav = (id) =>
    setFavIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const filtered = useMemo(() => {
    if (activeFilters.size === 0) return RESULTS
    return RESULTS.filter(r => {
      if (r.multiLeg) return !activeFilters.has('urban')
      if (activeFilters.has('morning')) {
        const h = parseInt(r.departTime)
        if (h >= 12) return false
      }
      if (activeFilters.has('reputation') && r.host.score < 4.7) return false
      if (activeFilters.has('pet') && !r.tags.includes('Pet-friendly')) return false
      if (activeFilters.has('urban') && r.scale !== 'Urban') return false
      if (activeFilters.has('intercity') && r.scale !== 'Intercity') return false
      if (activeFilters.has('women') && !r.tags.includes('Women-only')) return false
      return true
    })
  }, [activeFilters])

  if (isDesktop) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: '#F6FAF7' }}>
        <div className="max-w-[1280px] mx-auto px-8 py-8">
          <div className="mb-6">
            <h1 className="text-2xl font-bold" style={{ color: '#111827', fontFamily: "'Poppins', sans-serif" }}>Smart Search</h1>
            <p className="text-sm mt-0.5" style={{ color: '#6B7280' }}>Find rides across Malaysia with intelligent route matching</p>
          </div>

          <div className="mb-5">
            <SearchForm from={from} setFrom={setFrom} to={to} setTo={setTo}
              date={date} setDate={setDate} time={time} setTime={setTime}
              onSearch={() => setSearched(true)} isDesktop />
          </div>

          <div className="flex gap-8 items-start">
            <aside className="w-64 flex-shrink-0 sticky top-[88px] space-y-4">
              <div className="bg-white rounded-2xl p-4" style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.06)', border: '1px solid #E5E7EB' }}>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-bold" style={{ color: '#9CA3AF' }}>FILTERS</p>
                  {activeFilters.size > 0 && (
                    <button onClick={() => setActiveFilters(new Set())} className="text-xs" style={{ color: '#EF4444' }}>Clear all</button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {FILTERS.map(f => {
                    const on = activeFilters.has(f.id)
                    return (
                      <button key={f.id} onClick={() => toggleFilter(f.id)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold border transition-all"
                        style={{ backgroundColor: on ? '#16A34A' : 'white', color: on ? 'white' : '#374151', borderColor: on ? '#16A34A' : '#E5E7EB' }}>
                        <span style={{ opacity: on ? 1 : 0.6 }}>{f.icon}</span>{f.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="bg-white rounded-2xl p-4" style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.06)', border: '1px solid #E5E7EB' }}>
                <div className="flex items-center gap-2 mb-3">
                  <Star size={13} fill="#F59E0B" style={{ color: '#F59E0B' }} />
                  <p className="text-xs font-bold" style={{ color: '#9CA3AF' }}>SAVED RIDES</p>
                </div>
                <FavouritesPanel favIds={favIds} results={RESULTS} />
              </div>
            </aside>

            <main className="flex-1 min-w-0">
              {searched && (
                <div className="flex items-center justify-between mb-4">
                  <p className="text-sm font-semibold" style={{ color: '#374151' }}>
                    {filtered.length} result{filtered.length !== 1 ? 's' : ''}
                    {activeFilters.size > 0 && <span style={{ color: '#9CA3AF', fontWeight: 400 }}> · filtered</span>}
                  </p>
                  <div className="flex items-center gap-1.5 text-xs" style={{ color: '#9CA3AF' }}>
                    <SlidersHorizontal size={12} />
                    Sort: Departure time
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                {filtered.map(r =>
                  r.multiLeg
                    ? <div key={r.id} className="col-span-2"><MultiLegCard ride={r} isFav={favIds.has(r.id)} onToggleFav={() => toggleFav(r.id)} /></div>
                    : <RideCard key={r.id} ride={r} isFav={favIds.has(r.id)} onToggleFav={() => toggleFav(r.id)} onView={() => {}} />
                )}
                {filtered.length === 0 && (
                  <div className="col-span-2 text-center py-16">
                    <Search size={32} style={{ color: '#D1D5DB', margin: '0 auto 12px' }} />
                    <p className="text-sm font-semibold" style={{ color: '#9CA3AF' }}>No rides match your filters</p>
                    <button onClick={() => setActiveFilters(new Set())} className="text-xs mt-2" style={{ color: '#16A34A' }}>Clear filters</button>
                  </div>
                )}
              </div>
            </main>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen pb-24" style={{ backgroundColor: '#F6FAF7' }}>
      <div className="bg-white pt-12 px-4 pb-3" style={{ borderBottom: '1px solid #E5E7EB', boxShadow: '0 1px 0 #E5E7EB' }}>
        <h1 className="text-lg font-bold mb-3" style={{ color: '#111827', fontFamily: "'Poppins', sans-serif" }}>Smart Search</h1>
        <SearchForm from={from} setFrom={setFrom} to={to} setTo={setTo}
          date={date} setDate={setDate} time={time} setTime={setTime}
          onSearch={() => setSearched(true)} isDesktop={false} />
      </div>

      <div className="flex bg-white" style={{ borderBottom: '1px solid #E5E7EB' }}>
        {['results', 'favourites'].map(tab => (
          <button key={tab} onClick={() => setSideTab(tab)}
            className="flex-1 py-3 text-sm font-semibold capitalize transition-colors"
            style={{
              color: sideTab === tab ? '#16A34A' : '#9CA3AF',
              borderBottom: sideTab === tab ? '2px solid #16A34A' : '2px solid transparent',
              fontFamily: sideTab === tab ? "'Poppins', sans-serif" : 'inherit',
            }}>
            {tab === 'results' ? `Results${searched ? ` (${filtered.length})` : ''}` : `★ Saved`}
          </button>
        ))}
      </div>

      {sideTab === 'favourites' ? (
        <div className="px-4 pt-4">
          <FavouritesPanel favIds={favIds} results={RESULTS} />
        </div>
      ) : (
        <>
          {searched && (
            <div className="px-4 pt-3 pb-2">
              <FilterChips active={activeFilters} toggle={toggleFilter} />
            </div>
          )}

          <div className="px-4 pt-2 space-y-3">
            {!searched ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4" style={{ backgroundColor: '#DCFCE7' }}>
                  <Search size={24} style={{ color: '#16A34A' }} />
                </div>
                <p className="text-sm font-semibold mb-1" style={{ color: '#374151', fontFamily: "'Poppins', sans-serif" }}>Find your ride</p>
                <p className="text-xs" style={{ color: '#9CA3AF' }}>Enter your route above and tap Search</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Search size={28} style={{ color: '#D1D5DB', margin: '0 auto 12px' }} />
                <p className="text-sm font-semibold" style={{ color: '#9CA3AF' }}>No rides match your filters</p>
                <button onClick={() => setActiveFilters(new Set())} className="text-xs mt-2" style={{ color: '#16A34A' }}>Clear filters</button>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between py-1">
                  <p className="text-xs font-semibold" style={{ color: '#374151' }}>
                    {filtered.length} ride{filtered.length !== 1 ? 's' : ''} found
                  </p>
                  <div className="flex items-center gap-1 text-xs" style={{ color: '#9CA3AF' }}>
                    <SlidersHorizontal size={11} />Sort: Time
                  </div>
                </div>
                {filtered.map(r =>
                  r.multiLeg
                    ? <MultiLegCard key={r.id} ride={r} isFav={favIds.has(r.id)} onToggleFav={() => toggleFav(r.id)} />
                    : <RideCard key={r.id} ride={r} isFav={favIds.has(r.id)} onToggleFav={() => toggleFav(r.id)} onView={() => {}} />
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}