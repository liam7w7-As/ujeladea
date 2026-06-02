import { useNavigate, useLocation } from 'react-router-dom'
import { useExamen } from '../context/ExamenContext'
import { LogOut, LayoutDashboard, Database, Trophy, Building2 } from 'lucide-react'

export default function NavAdmin() {
  const { usuario, logoutAdmin } = useExamen()
  const navigate = useNavigate()
  const location = useLocation()

  const handleLogout = async () => {
    await logoutAdmin()
    localStorage.removeItem('torneo_admin')
    navigate('/admin')
  }

  const links = [
    { label: 'Dashboard', path: '/admin/dashboard', icon: <LayoutDashboard size={18} /> },
    { label: 'Ranking', path: '/admin/ranking', icon: <Trophy size={18} /> },
    { label: 'Sociedades', path: '/admin/sociedades', icon: <Building2 size={18} /> },
    { label: 'Banco de Preguntas', path: '/admin/preguntas', icon: <Database size={18} /> },
  ]

  const isActive = (path) => {
    // Si estamos en dashboard
    if (path === '/admin/dashboard' && location.pathname === '/admin/dashboard') return true;
    if (path === '/admin/dashboard' && location.pathname.startsWith('/admin/sesion') && !location.pathname.includes('/resultados') && !location.pathname.includes('/calificar')) return true; // SalaEspera / CrearSesion entran aqui como flujo del dashboard.
    
    // Si no es el dashboard base
    if (path !== '/admin/dashboard' && location.pathname.startsWith(path)) return true;
    
    return false;
  }

  return (
    <nav style={{ 
      background: 'var(--color-bg-raised)', 
      borderBottom: '1px solid var(--color-border)',
      padding: '0 var(--space-lg)',
      boxShadow: 'var(--shadow-md)',
      position: 'sticky',
      top: 0,
      zIndex: 100,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      minHeight: '60px',
      flexWrap: 'wrap',
      gap: 'var(--space-md)'
    }}>
      
      {/* Brand & Links */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xl)', flex: 1, minWidth: '300px' }}>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
          <img src="/logo.png" alt="Logo" style={{ width: '32px', height: '32px', borderRadius: '8px', border: '1px solid var(--color-accent)' }} />
          <span className="brand-title hide-mobile" style={{ fontSize: '1.2rem', marginBottom: 0 }}>
            UJELADEA
          </span>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-md)', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          {links.map(link => {
            const active = isActive(link.path)
            return (
              <button
                key={link.path}
                onClick={() => navigate(link.path)}
                style={{
                  background: 'none',
                  border: 'none',
                  borderBottom: `2px solid ${active ? 'var(--color-primary)' : 'transparent'}`,
                  color: active ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '18px 8px',
                  fontSize: '0.95rem',
                  fontWeight: active ? 600 : 400,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  whiteSpace: 'nowrap'
                }}
              >
                {link.icon}
                <span className="hide-mobile">{link.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* User / Settings / Logout */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
        <div className="hide-mobile" style={{
          background: 'var(--color-bg-surface)',
          padding: '6px 12px',
          borderRadius: 'var(--radius-xl)',
          fontSize: '0.85rem',
          color: 'var(--color-text-secondary)',
          border: '1px solid var(--color-border)',
          marginRight: '8px'
        }}>
          admin
        </div>
        <button onClick={handleLogout} className="btn" style={{ background: 'transparent', padding: '8px', color: 'var(--color-text-muted)', minWidth: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }} title="Cerrar Sesión">
          <LogOut size={20} />
          <span className="hide-mobile" style={{ fontSize: '0.85rem' }}>Salir</span>
        </button>
      </div>

    </nav>
  )
}
