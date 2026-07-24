// ===== PRESENTATION LAYER (AuthPage) =====
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import '../styles/auth.css';

export default function AuthPage() {
  const { signUp, signIn } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState('signup'); // 'signup' | 'login'
  const [method, setMethod] = useState('email'); // 'email' | 'phone'
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'signup') {
        await signUp({ fullName, email, phone, password, method });
      } else {
        await signIn({ email, password });
      }
      navigate('/profile');
    } catch (err) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      {/* ---------- Left: journey scene ---------- */}
      <div className="auth-scene">
        <div className="scene-brand">
          <div className="brand-icon">🚗</div>
          <div>
            <div className="scene-brand-name">Let's Tumpang</div>
            <div className="scene-brand-tag">Community Carpooling</div>
          </div>
        </div>

        <div>
          <h1 className="scene-headline">
            Every empty seat is <em>somebody's</em> ride home.
          </h1>
          <p className="scene-subline">
            Share the highway, split the toll, cut the carbon. Join commuters across
            Klang Valley turning solo drives into company.
          </p>

          <div className="route-map">
            <svg className="route-svg" viewBox="0 0 400 150" preserveAspectRatio="none">
              <path className="route-path" d="M8,120 C 90,120 90,40 170,40 S 300,110 392,26" />
              <g className="route-node">
                <circle cx="8" cy="120" r="5" />
                <text x="18" y="138">KL Sentral</text>
              </g>
              <g className="route-node">
                <circle cx="170" cy="40" r="5" />
                <text x="150" y="24">Genting</text>
              </g>
              <g className="route-node">
                <circle cx="392" cy="26" r="5" />
                <text x="345" y="16">Ipoh</text>
              </g>
            </svg>
            <span className="route-car">🚙</span>
          </div>

          <div className="scene-stats">
            <div>
              <div className="scene-stat-value">3,200+</div>
              <div className="scene-stat-label">Commuters onboard</div>
            </div>
            <div>
              <div className="scene-stat-value">12.4t</div>
              <div className="scene-stat-label">CO₂ saved this month</div>
            </div>
            <div>
              <div className="scene-stat-value">4.9★</div>
              <div className="scene-stat-label">Average host rating</div>
            </div>
          </div>
        </div>
      </div>

      {/* ---------- Right: form ---------- */}
      <div className="auth-form-side">
        <div className="auth-form-wrap">
          <div className="auth-eyebrow">{mode === 'signup' ? 'Get started' : 'Welcome back'}</div>
          <h2 className="auth-title">{mode === 'signup' ? 'Create your account' : 'Sign in to Tumpang'}</h2>
          <p className="auth-subtitle">
            {mode === 'signup'
              ? 'Join thousands of commuters sharing rides and reducing emissions.'
              : 'Pick up right where you left off.'}
          </p>

          <div className="segmented">
            <button type="button" className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>
              Sign Up
            </button>
            <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
              Login
            </button>
          </div>

          <div className="method-toggle">
            <button type="button" className={'method-pill' + (method === 'email' ? ' active' : '')} onClick={() => setMethod('email')}>
              ✉ Email
            </button>
            <button type="button" className={'method-pill' + (method === 'phone' ? ' active' : '')} onClick={() => setMethod('phone')}>
              📞 Phone
            </button>
          </div>

          {error && <div className="auth-error">{error}</div>}

          <form onSubmit={handleSubmit}>
            {mode === 'signup' && (
              <div className="auth-field">
                <label>Full Name</label>
                <div className="auth-input-wrap">
                  <span className="prefix">👤</span>
                  <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Jamie Delacroix" required />
                </div>
              </div>
            )}

            {method === 'email' ? (
              <div className="auth-field">
                <label>Email Address</label>
                <div className="auth-input-wrap">
                  <span className="prefix">✉</span>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jamie@email.com" required />
                </div>
              </div>
            ) : (
              <div className="auth-field">
                <label>Phone Number</label>
                <div className="auth-input-wrap">
                  <span className="prefix">📞</span>
                  <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+60 12-345 6789" required />
                </div>
              </div>
            )}

            <div className="auth-field">
              <label>Password</label>
              <div className="auth-input-wrap">
                <span className="prefix">🔒</span>
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min. 8 characters"
                  minLength={8}
                  required
                />
                <button type="button" className="toggle-visibility" onClick={() => setShowPw((s) => !s)}>
                  {showPw ? '🙈' : '👁'}
                </button>
              </div>
            </div>

            <button className="auth-submit" type="submit" disabled={loading}>
              {loading ? 'Please wait…' : mode === 'signup' ? 'Create Account →' : 'Sign In →'}
            </button>
          </form>

          <p className="auth-switch">
            {mode === 'signup' ? (
              <>Already have an account? <button onClick={() => setMode('login')}>Sign in</button></>
            ) : (
              <>New here? <button onClick={() => setMode('signup')}>Create an account</button></>
            )}
          </p>

          {mode === 'signup' && <p className="auth-demo-hint">Demo: use test@example.com to trigger a duplicate-account error</p>}
        </div>
      </div>
    </div>
  );
}
