import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Calendar, Plus, Trophy, Users, Trash2 } from 'lucide-react'
import { useEtapa } from '../../context/etapa-context'
import { cargarResumenEtapa, sesionConSociedad } from '../../lib/etapas'
import { supabase } from '../../lib/supabase'
import NavAdmin from '../../components/NavAdmin'
import EtapaAviso from '../../components/EtapaAviso'
import EstadoBadge from '../../components/EstadoBadge'
import DialogoEtapa from '../../components/DialogoEtapa'

export default function Dashboard() {
  const { etapa, archivo, soloLectura } = useEtapa()
  const [estado, setEstado] = useState({ datos: null, error: '' })
  const [revision, setRevision] = useState(0), [eliminar, setEliminar] = useState(null), [confirmacion, setConfirmacion] = useState(''), [borrando, setBorrando] = useState(false), [errorEliminar, setErrorEliminar] = useState('')
  async function confirmarEliminacion(e) {
    e.preventDefault()
    if (borrando || confirmacion !== 'ELIMINAR') return
    setBorrando(true); setErrorEliminar('')
    try {
      const { error } = await supabase.rpc('admin_sesion_eliminar', { p_sesion: eliminar.id, p_etapa: etapa.id, p_confirmacion: confirmacion })
      if (error) throw error
      setEliminar(null); setRevision(n => n + 1)
    } catch (err) { setErrorEliminar(err.message) }
    finally { setBorrando(false) }
  }
  useEffect(() => {
    let vigente = true
    cargarResumenEtapa(supabase, etapa, archivo, "sesiones")
      .then(datos => { if (vigente) setEstado({ datos, error: '' }) })
      .catch(err => { if (vigente) setEstado({ datos: null, error: err.message }) })
    return () => { vigente = false }
  }, [etapa, archivo, revision])
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
        return <article className="card etapa-session" key={s.id}><div><div className="etapa-session-title"><h2>{sesion.sociedades?.nombre || 'Sociedad'}</h2><EstadoBadge estado={s.estado} size="sm" /></div><p><Calendar size={14} />{new Date(s.created_at).toLocaleDateString('es-BO')}<Users size={14} />{parts.length} participantes · {s.cantidad_preguntas} preguntas · {s.tiempo_limite} min</p></div><div className="etapa-actions">
          {s.estado === 'finalizado' || soloLectura ? <><Link className="btn btn-secondary" to={`/admin/sesion/${s.id}/resultados`}><Trophy size={16} />Resultados</Link>{!soloLectura && pendientes && <Link className="btn btn-primary" to={`/admin/sesion/${s.id}/calificar`}>Calificar pendientes</Link>}</> : <Link className="btn btn-primary" to={`/admin/sesion/${s.id}/espera`}>Sala de control</Link>}
          {!soloLectura && <button className="btn btn-secondary" onClick={() => { setEliminar(s); setConfirmacion(''); setErrorEliminar('') }}><Trash2 size={16}/>Eliminar sesión</button>}
        </div></article>
      })}</div>}
    {eliminar && <DialogoEtapa bloqueado={borrando} onClose={() => setEliminar(null)}><h2 id="confirmar-etapa-titulo">Eliminar sesión</h2><p>Esta sesión y sus resultados dejarán de aparecer en el panel, los informes, el ranking y la premiación. Su QR dejará de funcionar.</p><form onSubmit={confirmarEliminacion}><label className="form-label">Escribe ELIMINAR para confirmar<input className="form-input" value={confirmacion} maxLength={8} autoComplete="off" onChange={e => setConfirmacion(e.target.value)} disabled={borrando}/></label>{errorEliminar && <p role="alert" className="alert alert-error">{errorEliminar}</p>}<div className="etapa-actions"><button type="button" className="btn btn-secondary" disabled={borrando} onClick={() => setEliminar(null)}>Cancelar</button><button className="btn btn-primary" disabled={borrando || confirmacion !== 'ELIMINAR'}>{borrando ? 'Eliminando…' : 'Confirmar eliminación'}</button></div></form></DialogoEtapa>}
  </main></>
}
