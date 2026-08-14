import { MapPin, Calendar, Clock, Search } from 'lucide-react'

export default function SearchForm({
  from, setFrom, to, setTo, date, setDate, time, setTime, onSearch, isDesktop,
}) {
  const inputBase = {
    backgroundColor: '#F9FAFB', border: '1.5px solid #E5E7EB', color: '#111827',
    borderRadius: 12, outline: 'none', fontSize: 14, width: '100%',
  }
  const iconStyle = { color: '#9CA3AF', flexShrink: 0 }
  const labelStyle = { color: '#6B7280', fontSize: 11, fontWeight: 600, marginBottom: 4 }

  const Field = ({ icon, label, value, onChange, type = 'text', placeholder }) => (
    <div className="flex-1 min-w-0">
      <p style={labelStyle}>{label}</p>
      <div className="flex items-center gap-2 px-3 py-2.5" style={inputBase}>
        <span>{icon}</span>
        <input
          type={type} value={value} onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 min-w-0 bg-transparent outline-none text-sm"
          style={{ color: '#111827' }}
        />
      </div>
    </div>
  )

  return (
    <div className="bg-white rounded-2xl p-4" style={{ boxShadow: '0 4px 20px rgba(0,0,0,0.08)', border: '1px solid #E5E7EB' }}>
      <div className={isDesktop ? 'flex items-end gap-3' : 'space-y-3'}>
        <Field icon={<MapPin size={14} style={iconStyle} />} label="DEPARTURE" value={from} onChange={setFrom} placeholder="From where?" />
        <Field icon={<MapPin size={14} style={{ ...iconStyle, color: '#EF4444' }} />} label="DESTINATION" value={to} onChange={setTo} placeholder="Where to?" />
        <Field icon={<Calendar size={14} style={iconStyle} />} label="DATE" value={date} onChange={setDate} type="date" />
        <Field icon={<Clock size={14} style={iconStyle} />} label="TIME" value={time} onChange={setTime} type="time" />
        <div className={isDesktop ? 'flex-shrink-0' : ''}>
          {isDesktop && <p style={labelStyle}>&nbsp;</p>}
          <button
            onClick={onSearch}
            className="flex items-center justify-center gap-2 font-bold text-white rounded-xl transition-all hover:opacity-90 active:scale-95"
            style={{
              backgroundColor: '#16A34A',
              padding: isDesktop ? '10px 24px' : '12px',
              width: isDesktop ? 'auto' : '100%',
              fontFamily: "'Poppins', sans-serif",
              fontSize: 14,
              boxShadow: '0 4px 12px rgba(22,163,74,0.3)',
            }}>
            <Search size={16} />
            {!isDesktop && 'Search Rides'}
            {isDesktop && 'Search'}
          </button>
        </div>
      </div>
    </div>
  )
}