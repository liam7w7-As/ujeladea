import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowRight, UserCheck } from 'lucide-react'
import { apiExamen } from '../../lib/participante-supabase'
import { rutaIntento } from '../../lib/estado-examen'
import EstadoParticipante from '../../components/EstadoParticipante'
import { buscarNombre, horaExamen } from '../../lib/experiencia-examen'
import InstruccionesExamen from '../../components/InstruccionesExamen'

export default function Registro() {
  const { sesionId } = useParams()
  const navigate = useNavigate()
  const [sala, setSala] = useState(null)
  const [seleccion, setSeleccion] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [error, setError] = useState('')
  const [procesando, setProcesando] = useState(false)
  const [codigo, setCodigo] = useState(() => { const v = new URLSearchParams(location.hash.slice(1)).get('recuperacion') || ''; if(v) history.replaceState(null,'',location.pathname); return v })
  const [revision, setRevision] = useState(0)
  const recargar = useCallback(() => setRevision(v => v + 1), [])
  useEffect(() => {
    let vigente = true
    apiExamen.sala(sesionId).then(async datos => {
      if (!vigente) return
      if (datos.intento_id && !codigo) {
        const estado = await apiExamen.estado(datos.intento_id)
        if (vigente) navigate(rutaIntento(sesionId, estado.intento.estado), { replace: true })
      } else { setSala(datos); setError('') }
    }).catch(err => { if (vigente) setError(err.message) })
    return () => { vigente = false }
  }, [sesionId, navigate, revision, codigo])
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
  if (!sala) return <EstadoParticipante cargando={!error} error={error} recargar={recargar} mensajeCarga="Preparando tu ingreso…" />
  const elegida = sala.participantes.find(p => p.id === seleccion)
  const visibles = sala.participantes.filter(p => buscarNombre(p.nombre).includes(buscarNombre(busqueda)))
  return <main className="page-wrapper"><div className="page-content">
    <header className="brand-header"><img src="/logo.png" alt="UJELADEA" className="joven-logo" /><h1 className="brand-title">Olimpiadas Bíblicas</h1><p className="joven-libro">{sala.etapa.nombre} · {sala.etapa.libro} · {sala.etapa.anio}</p><p className="brand-subtitle">{sala.sesion.sociedad}</p></header>
    <section className="card joven-registro"><h2>{sala.disponible ? 'Selecciona tu nombre' : 'La sesión no está abierta'}</h2><p className="joven-ayuda">{sala.disponible ? 'Comprueba tu nombre antes de confirmar. Tu progreso quedará vinculado a este dispositivo.' : 'El encargado te indicará cuándo puedes entrar.'}</p>
      {sala.disponible && sala.sesion.estado === 'activo' && <div className="etapa-aviso">La evaluación ya comenzó. Finaliza a las {horaExamen(sala.sesion.vence_at)}. Dispones del tiempo que quede hasta ese cierre, con la misma valoración y sin descuento por tardanza.</div>}
      {error && <p role="alert" className="alert alert-error">{error}</p>}
      {sala.disponible && sala.participantes.length > 0 && <><label className="form-label" htmlFor="buscar-nombre">Buscar mi nombre</label><input id="buscar-nombre" className="form-input joven-busqueda" type="search" value={busqueda} disabled={procesando} onChange={e => setBusqueda(e.target.value)} placeholder="Escribe tu nombre o apellido" autoComplete="off" /><div className="joven-nombres" role="group" aria-label="Participantes disponibles">{visibles.map(p => <button key={p.id} disabled={procesando} className={seleccion === p.id ? 'seleccionado' : ''} aria-pressed={seleccion === p.id} onClick={() => setSeleccion(p.id)}>{p.nombre}{seleccion === p.id && <UserCheck size={20} aria-hidden="true" />}</button>)}</div>{!visibles.length && <p role="status">No hay coincidencias. Prueba con otro apellido o borra la búsqueda.</p>}</>}
      {sala.disponible && !sala.participantes.length && <p>No quedan nombres disponibles. Si ya te registraste en otro dispositivo, pide al encargado un código de recuperación.</p>}
      {sala.disponible && <>{elegida && <div className="joven-identidad" role="status"><UserCheck size={20} aria-hidden="true" /><div>Vas a ingresar como<strong>{elegida.nombre}</strong><small>Comprueba que este nombre sea el tuyo.</small></div></div>}<button className="btn btn-primary" onClick={() => confirmar()} disabled={!elegida || procesando}>{procesando ? 'Preparando…' : 'Soy yo, confirmar'}<ArrowRight size={18} aria-hidden="true" /></button><details className="joven-recuperacion"><summary>No aparezco en la lista</summary><p>Pide al moderador que revise tu nombre o te agregue a esta sesión. Si ya te registraste, solicita recuperar tu examen.</p><button className="btn btn-secondary" disabled={procesando} onClick={recargar}>Actualizar la lista</button></details></>}
      <details className="joven-recuperacion" open={Boolean(codigo)}><summary>Tengo un código de recuperación</summary><label className="form-label" htmlFor="recuperacion">Código entregado por el encargado</label><input id="recuperacion" className="form-input" autoComplete="off" value={codigo} onChange={e => setCodigo(e.target.value)} maxLength={48} /><button className="btn btn-secondary" onClick={() => confirmar(true)} disabled={procesando || !codigo.trim()}>Recuperar mi examen</button></details>
    </section>
    {sala.disponible && <InstruccionesExamen etapa={sala.etapa} minutos={sala.sesion.tiempo_limite} />}
  </div></main>
}
