import { useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { LogOut, LayoutDashboard, Database, Trophy, Building2, Layers } from 'lucide-react'
import { useExamen } from '../context/ExamenContext'
import { useEtapa } from '../context/etapa-context'

export default function NavAdmin() {
  const { logoutAdmin } = useExamen()
  const { etapa } = useEtapa()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [saliendo, setSaliendo] = useState(false)
  async function salir() {
    setSaliendo(true)
    try { await logoutAdmin(); navigate('/admin/login', { replace: true }) }
    catch { setError('No se pudo cerrar la sesión. Intenta de nuevo.'); setSaliendo(false) }
  }
  return <header className="admin-header">
    <div className="admin-nav">
      <Link to="/admin/etapas" className="admin-brand"><img src="/logo.png" alt="" /><span>UJELADEA<small>Administración del torneo</small></span></Link>
      <nav aria-label="Administración" className="admin-links">
        <NavLink to="/admin/etapas"><Layers size={17} />Etapas</NavLink>
        {etapa && <><NavLink to="/admin/dashboard"><LayoutDashboard size={17} />Sesiones</NavLink><NavLink to="/admin/preguntas"><Database size={17} />Preguntas</NavLink><NavLink to="/admin/ranking"><Trophy size={17} />Ranking</NavLink></>}
        <NavLink to="/admin/sociedades"><Building2 size={17} />Sociedades</NavLink>
      </nav>
      <button onClick={salir} disabled={saliendo} className="btn btn-secondary admin-logout"><LogOut size={17} />{saliendo ? 'Saliendo…' : 'Salir'}</button>
    </div>
    {etapa && <div className="admin-stage-line">Evaluación: <strong>{etapa.libro} · {etapa.anio}</strong></div>}
    {error && <p className="alert alert-error" role="alert">{error}</p>}
  </header>
}
