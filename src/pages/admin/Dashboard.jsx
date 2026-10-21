import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Calendar, Plus, Trophy, Users } from 'lucide-react'
import { useEtapa } from '../../context/etapa-context'
import { cargarResumenEtapa, sesionConSociedad } from '../../lib/etapas'
import { supabase } from '../../lib/supabase'
import NavAdmin from '../../components/NavAdmin'
import EtapaAviso from '../../components/EtapaAviso'
import EstadoBadge from '../../components/EstadoBadge'

export default function Dashboard() {
  const { etapa, archivo, soloLectura } = useEtapa()
  const [estado, setEstado] = useState({ datos: null, error: '' })
  useEffect(() => {
    let vigente = true
    cargarResumenEtapa(supabase, etapa, archivo, "sesiones")
      .then(datos => { if (vigente) setEstado({ datos, error: '' }) })
      .catch(err => { if (vigente) setEstado({ datos: null, error: err.message }) })
    return () => { vigente = false }
  }, [etapa, archivo])
  const sesiones = estado.datos?.sesiones.toSorted((a, b) => new Date(b.created_at) - new Date(a.created_at)) || []
  return <><NavAdmin /><main className="admin-content">
    <EtapaAviso />
    <div className="etapa-heading"><div><p className="eyebrow">{soloLectura ? 'Historial' : 'Organización'}</p><h1>Sesiones de {etapa.libro}</h1></div>{!soloLectura && <Link className="btn btn-primary" to="/admin/sesion/nueva"><Plus size={18} />Nueva sesión</Link>}</div>
    {estado.error ? <p className="alert alert-error" role="alert">{estado.error}</p> : !estado.datos ? <p role="status">Cargando sesiones…</p> :
      sesiones.length === 0 ? <section className="card etapa-empty"><Calendar size={40} /><h2>Todo listo para organizarte</h2><p>Esta etapa todavía no tiene sesiones. Su banco de preguntas se prepara por separado.</p><Link className="btn btn-secondary" to="/admin/preguntas">Preparar preguntas</Link></section> :
      <div className="etapa-session-list">{sesiones.map(s => {
        const sesion = sesionConSociedad(estado.datos, s.id)
        const parts = estado.datos.participantes.filter(p => p.sesion_id === s.id)
        const ids = new Set(parts.map(p => p.id))
        const pendientes = estado.datos.respuestas.some(r => ids.has(r.participante_id) && (r.calificado_por === 'pendiente_ia' || r.puntaje_obtenido === null))
        return <article className="card etapa-session" key={s.id}><div><div className="etapa-session-title"><h2>{sesion.sociedades?.nombre || 'Sociedad'}</h2><EstadoBadge estado={s.estado} size="sm" /></div><p><Calendar size={14} />{new Date(s.created_at).toLocaleDateString('es-BO')}<Users size={14} />{parts.length} participantes</p></div><div className="etapa-actions">
          {s.estado === 'finalizado' || soloLectura ? <><Link className="btn btn-secondary" to={`/admin/sesion/${s.id}/resultados`}><Trophy size={16} />Resultados</Link>{!soloLectura && pendientes && <Link className="btn btn-primary" to={`/admin/sesion/${s.id}/calificar`}>Calificar pendientes</Link>}</> : <Link className="btn btn-primary" to={`/admin/sesion/${s.id}/espera`}>Sala de control</Link>}
        </div></article>
      })}</div>}
  </main></>
}
