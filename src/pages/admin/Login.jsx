import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useExamen } from '../../context/ExamenContext'
import { BookOpen, LogIn, AlertCircle } from 'lucide-react'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)
  const { loginAdmin } = useExamen()
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setCargando(true)

    try {
      await loginAdmin(email, password)
      navigate('/admin/dashboard')
    } catch (err) {
      setError(
        err.message === 'Invalid login credentials'
          ? 'Credenciales incorrectas. Verifica tu email y contraseña.'
          : err.message || 'Error al iniciar sesión.'
      )
    } finally {
      setCargando(false)
    }
  }

  return (
    <div className="page-wrapper">
      <div className="page-content animate-in">
        <div className="card">
          {/* Header de marca */}
          <div className="brand-header">
            <div className="brand-icon" style={{ background: 'transparent', boxShadow: 'none' }}>
              <img src="/logo.png" alt="Torneo Bíblico Logo" style={{ width: '80px', height: '80px', borderRadius: '16px', objectFit: 'cover', border: '2px solid var(--color-accent)', boxShadow: 'var(--shadow-glow)' }} />
            </div>
            <h1 className="brand-title">Olimpiadas Bíblicas</h1>
            <p style={{ color: 'var(--color-accent)', fontSize: '0.95rem', marginTop: '-8px', fontWeight: 600 }}>UJELADEA 2026 — 1ra Etapa HEBREOS</p>
            <p className="brand-subtitle">UJELADEA</p>
          </div>

          <div className="divider" />

          {/* Mensaje de error */}
          {error && (
            <div className="alert alert-error" role="alert" id="login-error">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          {/* Formulario */}
          <form onSubmit={handleSubmit} autoComplete="on">
            <div className="form-group">
              <label htmlFor="login-email" className="form-label">
                Correo electrónico
              </label>
              <input
                id="login-email"
                type="email"
                className="form-input"
                placeholder="admin@ujeladea.org"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                autoFocus
              />
            </div>

            <div className="form-group">
              <label htmlFor="login-password" className="form-label">
                Contraseña
              </label>
              <input
                id="login-password"
                type="password"
                className="form-input"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>

            <button
              id="login-submit"
              type="submit"
              className="btn btn-primary"
              disabled={cargando || !email || !password}
            >
              {cargando ? (
                <>
                  <span className="spinner" />
                  Ingresando…
                </>
              ) : (
                <>
                  <LogIn size={18} />
                  Ingresar al panel
                </>
              )}
            </button>
          </form>

          <div className="divider" />

          <p style={{
            textAlign: 'center',
            fontSize: '0.75rem',
            color: 'var(--color-text-muted)',
            lineHeight: '1.5'
          }}>
            Acceso exclusivo para administradores del torneo.
            <br />
            «Lámpara es a mis pies tu palabra» — Salmo 119:105
          </p>
        </div>
      </div>
    </div>
  )
}
