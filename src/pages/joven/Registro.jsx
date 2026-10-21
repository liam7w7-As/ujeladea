import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowRight, UserCheck } from 'lucide-react'
import { apiExamen } from '../../lib/participante-supabase'
import { rutaIntento } from '../../lib/estado-examen'
import EstadoParticipante from '../../components/EstadoParticipante'

export default function Registro() {
  const { sesionId } = useParams()
  const navigate = useNavigate()
  const [sala, setSala] = useState(null)
  const [seleccion, setSeleccion] = useState('')
  const [error, setError] = useState('')
  const [procesando, setProcesando] = useState(false)
  const [codigo, setCodigo] = useState('')
  const [revision, setRevision] = useState(0)
  const recargar = useCallback(() => setRevision(v => v + 1), [])
  useEffect(() => {
    let vigente = true
    apiExamen.sala(sesionId).then(async datos => {
      if (!vigente) return
      if (datos.intento_id) {
        const estado = await apiExamen.estado(datos.intento_id)
        if (vigente) navigate(rutaIntento(sesionId, estado.intento.estado), { replace: true })
      } else { setSala(datos); setError('') }
    }).catch(err => { if (vigente) setError(err.message) })
    return () => { vigente = false }
  }, [sesionId, navigate, revision])
  async function confirmar(recuperar = false) {
    if (procesando || (!recuperar && !seleccion)) return
    setProcesando(true)
    setError('')
    try {
      const estado = recuperar ? await apiExamen.recuperar(sesionId, codigo) : await apiExamen.registrar(sesionId, seleccion)
      navigate(rutaIntento(sesionId, estado.intento.estado), { replace: true })
    } catch (err) { setError(err.message); recargar() }
    finally { setProcesando(false) }
  }
  if (!sala) return <EstadoParticipante cargando={!error} error={error} recargar={recargar} />
  return <main className="page-wrapper"><div className="page-content">
    <header className="brand-header"><img src="/logo.png" alt="UJELADEA" className="joven-logo" /><h1 className="brand-title">Olimpiadas Bíblicas</h1><p className="joven-libro">{sala.etapa.nombre} · {sala.etapa.libro} · {sala.etapa.anio}</p><p className="brand-subtitle">{sala.sesion.sociedad}</p></header>
    <section className="card joven-registro"><h2>{sala.disponible ? 'Selecciona tu nombre' : 'La sesión no está abierta'}</h2><p className="joven-ayuda">{sala.disponible ? 'Comprueba tu nombre antes de confirmar. Tu progreso quedará vinculado a este dispositivo.' : 'El encargado te indicará cuándo puedes entrar.'}</p>
      {error && <p role="alert" className="alert alert-error">{error}</p>}
      <div className="joven-nombres">{sala.participantes.map(p => <button key={p.id} disabled={procesando} className={seleccion === p.id ? 'seleccionado' : ''} aria-pressed={seleccion === p.id} onClick={() => setSeleccion(p.id)}>{p.nombre}{seleccion === p.id && <UserCheck size={20} />}</button>)}</div>
      {sala.disponible && !sala.participantes.length && <p>No quedan nombres disponibles. Si ya te registraste en otro dispositivo, pide al encargado un código de recuperación.</p>}
      {sala.disponible && <button className="btn btn-primary" onClick={() => confirmar()} disabled={!seleccion || procesando}>{procesando ? 'Preparando…' : 'Soy yo, confirmar'}<ArrowRight size={18} /></button>}
      <details className="joven-recuperacion"><summary>Tengo un código de recuperación</summary><label className="form-label" htmlFor="recuperacion">Código entregado por el encargado</label><input id="recuperacion" className="form-input" autoComplete="off" value={codigo} onChange={e => setCodigo(e.target.value)} maxLength={48} /><button className="btn btn-secondary" onClick={() => confirmar(true)} disabled={procesando || !codigo.trim()}>Recuperar mi examen</button></details>
    </section>
  </div></main>
}
