import { BookOpen, Construction, ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export default function PlaceholderPage({ title, description, backTo, backLabel }) {
  const navigate = useNavigate()

  return (
    <div className="page-wrapper">
      <div className="page-content animate-in">
        <div className="card placeholder-page">
          <div className="brand-header">
            <div className="brand-icon" style={{ background: 'transparent', boxShadow: 'none' }}>
              <img src="/logo.png" alt="Torneo Bíblico Logo" style={{ width: '80px', height: '80px', borderRadius: '16px', objectFit: 'cover', border: '2px solid var(--color-accent)', boxShadow: 'var(--shadow-glow)' }} />
            </div>
            <h1 className="brand-title">Olimpiadas Bíblicas</h1>
            <p style={{ color: 'var(--color-accent)', fontSize: '0.95rem', marginTop: '-8px', fontWeight: 600 }}>UJELADEA 2026 — 1ra Etapa HEBREOS</p>
            <p className="brand-subtitle">UJELADEA</p>
          </div>

          <div className="divider" />

          <div className="placeholder-badge">
            <Construction size={14} />
            En construcción
          </div>

          <h2 className="placeholder-title">{title}</h2>
          <p className="placeholder-text">
            {description || 'Esta sección estará disponible pronto.'}
          </p>

          {backTo && (
            <div className="placeholder-nav">
              <button
                className="btn btn-secondary"
                onClick={() => navigate(backTo)}
              >
                <ArrowLeft size={16} />
                {backLabel || 'Volver'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
