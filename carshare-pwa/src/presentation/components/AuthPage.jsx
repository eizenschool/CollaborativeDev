// ===== PRESENTATION LAYER (AuthPage) =====
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { IconCar, IconMail, IconUser, IconLock, IconEye, IconEyeOff, IconArrowRight, IconStar, IconGoogle, IconShield } from './icons.jsx';
import '../styles/auth.css';

export default function AuthPage() {
  const { signUp, signIn, signInWithGoogle } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState('signup'); // 'signup' | 'login'
  const [fullName, setFullName] = useState('');
  const [icNumber, setIcNumber] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [verificationMessage, setVerificationMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  // One button covers both Sign Up and Login: Supabase's Google provider
  // creates the auth.users row on first arrival and just signs the user in on
  // every visit after, so there's no separate "sign up with Google" call.
  // This redirects away from the page, so on success there is nothing further
  // to do here - AuthContext picks the session up when the browser returns.
  async function handleGoogle() {
    setError('');
    setVerificationMessage('');
    setGoogleLoading(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(err.message || 'Google sign-in failed.');
      setGoogleLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setVerificationMessage('');
    setLoading(true);
    try {
      if (mode === 'signup') {
        const result = await signUp({ fullName, email, password, icNumber });
        if (result.requiresEmailConfirmation) {
          setVerificationMessage(`We sent a confirmation link to ${result.email}. Confirm it before signing in.`);
          return;
        }
      } else {
        await signIn({ email, password });
      }
      navigate('/home');
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
          <div className="brand-icon"><IconCar size={18} /></div>
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
            <span className="route-car"><IconCar size={22} /></span>
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
              <div className="scene-stat-value scene-stat-rating"><IconStar size={18} /> 4.9</div>
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

          {error && <div className="auth-error">{error}</div>}
          {verificationMessage && <div className="alert alert-success">{verificationMessage}</div>}

          <button
            type="button"
            className="google-btn"
            onClick={handleGoogle}
            disabled={googleLoading || loading}
          >
            <IconGoogle size={18} />
            {googleLoading ? 'Redirecting to Google…' : mode === 'signup' ? 'Sign up with Google' : 'Continue with Google'}
          </button>

          <div className="auth-divider"><span>or {mode === 'signup' ? 'sign up' : 'sign in'} with email</span></div>

          <form onSubmit={handleSubmit}>
            {mode === 'signup' && (
              <div className="auth-field">
                <label>Full Name</label>
                <div className="auth-input-wrap">
                  <span className="prefix"><IconUser size={16} /></span>
                  <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Jamie Delacroix" required />
                </div>
              </div>
            )}

            {mode === 'signup' && (
              <div className="auth-field">
                <label>IC Number (MyKad) <span className="hint">used to verify your identity, never stored</span></label>
                <div className="auth-input-wrap">
                  <span className="prefix"><IconShield size={16} /></span>
                  <input
                    value={icNumber}
                    onChange={(e) => setIcNumber(e.target.value)}
                    placeholder="990101-14-5678"
                    inputMode="numeric"
                    autoComplete="off"
                    required
                  />
                </div>
              </div>
            )}

            <div className="auth-field">
              <label>Email Address</label>
              <div className="auth-input-wrap">
                <span className="prefix"><IconMail size={16} /></span>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jamie@email.com" required />
              </div>
            </div>

            <div className="auth-field">
              <label>Password</label>
              <div className="auth-input-wrap">
                <span className="prefix"><IconLock size={16} /></span>
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min. 8 characters"
                  minLength={8}
                  required
                />
                <button type="button" className="toggle-visibility" onClick={() => setShowPw((s) => !s)}>
                  {showPw ? <IconEyeOff size={15} /> : <IconEye size={15} />}
                </button>
              </div>
            </div>

            <button className="auth-submit" type="submit" disabled={loading}>
              {loading ? 'Please wait…' : mode === 'signup' ? 'Create Account' : 'Sign In'}
              {!loading && <IconArrowRight size={16} />}
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
