import { useEffect, useState, useSyncExternalStore } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { ArrowRight, Check, Clock, Maximize } from 'lucide-react'
import useIntento from '../../hooks/useIntento'
import { apiExamen } from '../../lib/participante-supabase'
import { rutaIntento } from '../../lib/estado-examen'
import { BorradorExamen } from '../../lib/borradores'
import { SeguridadExamen } from '../../lib/seguridad'
import EstadoParticipante from '../../components/EstadoParticipante'
import AccesoPendiente from '../../components/AccesoPendiente'
import AdvertenciaOverlay from '../../components/AdvertenciaOverlay'
import Modal from '../../components/Modal'
import InstruccionesExamen from '../../components/InstruccionesExamen'

function Pregunta({ pregunta, intento, aplicar }) {
  const [entrega,setEntrega]=useState(false)
  const [gestor] = useState(() => new BorradorExamen({ api: apiExamen, intento: intento.id, pregunta, storage: globalThis.localStorage, onEstado: aplicar }))
  const borrador = useSyncExternalStore(gestor.subscribe, gestor.getSnapshot)
  useEffect(() => {
    gestor.iniciar()
    const online = () => { void gestor.reintentar() }
    window.addEventListener('online', online)
    return () => { window.removeEventListener('online', online); gestor.destruir() }
  }, [gestor])
  useEffect(() => { gestor.sincronizar(pregunta) }, [gestor, pregunta])
  const enviando = borrador.estado === 'enviando'
  const bloqueado = enviando || borrador.estado === 'pendiente'
  const mensajes = {
    guardado: 'Borrador guardado en el servidor.',
    local: 'Cambios conservados en este dispositivo. Esperando sincronización…',
    guardando: 'Guardando borrador…',
    error: 'No pudimos sincronizar. Tu texto sigue en este dispositivo.',
    pendiente: 'La confirmación está pendiente. Reintentaremos el mismo envío al conectar.',
    enviando: 'Confirmando tu respuesta…',
    conflicto: 'Hay otro borrador en el servidor. Elige cuál conservar antes de continuar.',
  }
  return <section className="joven-pregunta" aria-labelledby="pregunta-titulo">
    <div className="card joven-enunciado"><p className="eyebrow">{pregunta.tipo === 'multiple' ? 'Opción múltiple' : pregunta.tipo === 'contexto' ? 'Contexto bíblico' : 'Respuesta abierta'} · {pregunta.puntaje} puntos</p><h1 id="pregunta-titulo">{pregunta.texto}</h1></div>
    {pregunta.tipo === 'multiple' ? <div className="joven-opciones" role="group" aria-label="Opciones de respuesta">{pregunta.opciones.map((opcion,i) => <button key={i} disabled={bloqueado} className={borrador.texto === opcion ? 'seleccionada' : ''} aria-pressed={borrador.texto === opcion} onClick={() => gestor.cambiar(opcion)}><span>{String.fromCharCode(65+i)}</span>{opcion}{borrador.texto === opcion && <Check size={20} />}</button>)}</div> :
      <label className="joven-respuesta"><span className="form-label">Tu respuesta</span><textarea className="form-input" rows={7} value={borrador.texto} disabled={bloqueado} onChange={e => gestor.cambiar(e.target.value)} maxLength={2000} placeholder="Escribe tu respuesta aquí…" /><small>{borrador.texto.length} / 2000 caracteres</small></label>}
    <div className="joven-siguiente"><div className="joven-resumen-guardado">    <div className={'joven-guardado ' + borrador.estado} role="status"><p>{mensajes[borrador.estado]}</p>{!borrador.localDisponible && <p>Este navegador no permite guardar una copia local. Espera a ver la confirmación del servidor antes de salir.</p>}
      {borrador.estado === 'conflicto' ? <div className="etapa-actions"><button className="btn btn-secondary" onClick={() => gestor.usarGuardado()}>Usar el borrador del servidor</button><button className="btn btn-secondary" onClick={() => gestor.conservarLocal()}>Conservar mi texto de esta pantalla</button></div> :
        ['error','pendiente'].includes(borrador.estado) && <button className="btn btn-secondary" onClick={() => gestor.reintentar()}>Reintentar guardado</button>}
    </div>
<p>Al confirmar, tu respuesta queda registrada y ya no podrás cambiarla.</p></div><button className="btn btn-primary" disabled={!borrador.texto.trim() || enviando || borrador.estado === 'conflicto'} onClick={() => pregunta.posicion===intento.total && borrador.estado!=='pendiente'?setEntrega(true):gestor.confirmar()}>{enviando ? 'Confirmando…' : borrador.estado === 'pendiente' ? 'Reintentar confirmación' : pregunta.posicion === intento.total ? 'Confirmar y finalizar' : 'Confirmar y continuar'}<ArrowRight size={18} /></button></div>
    <Modal isOpen={entrega} onClose={()=>setEntrega(false)} titulo="Entregar evaluación" mensaje={'Se confirmará la última respuesta y se entregará tu examen de '+intento.total+' preguntas. La entrega es definitiva.'} isConfirm textoConfirmar="Confirmar entrega" onConfirm={()=>{setEntrega(false);void gestor.confirmar()}}/>
  </section>
}

export default function Examen() {
  const { sesionId } = useParams()
  const estado = useIntento(sesionId)
  const [restante, setRestante] = useState(null)
  const [overlay, setOverlay] = useState(false)
  const [aviso, setAviso] = useState(false)
  const datos = estado.datos
  const { recargar } = estado
  const vence = datos?.intento.vence_at
  const servidor = datos?.servidor_at
  useEffect(() => {
    if (!vence || !servidor) return
    const recibido = Date.now()
    let consultado = false
    const calcular = () => {
      const ms = Math.max(0, Date.parse(vence) - (Date.parse(servidor) + Date.now() - recibido))
      setRestante(ms)
      if (ms === 0 && !consultado) { consultado = true; void recargar() }
    }
    const primero = setTimeout(calcular, 0)
    const timer = setInterval(calcular, 1000)
    return () => { clearTimeout(primero); clearInterval(timer) }
  }, [vence, servidor, recargar])
  const intentoId = datos?.intento.id
  const estadoIntento = datos?.intento.estado
  useEffect(() => {
    if (!intentoId || estadoIntento !== 'en_curso' || datos?.acceso?.pendiente) return
    const seguridad = new SeguridadExamen({ intento: intentoId, reportar: apiExamen.eventos, onAdvertencia: tipo => {
      if (tipo === 'salio_fullscreen') setOverlay(true)
      else setAviso(true)
    } })
    seguridad.iniciar()
    return () => seguridad.destruir()
  }, [intentoId, estadoIntento, datos?.acceso?.pendiente])
  async function pantallaCompleta() {
    setOverlay(false)
    try { if (document.fullscreenEnabled && !document.fullscreenElement) await document.documentElement.requestFullscreen() }
    catch { setAviso(true) }
  }
  if (estado.sinIntento) return <Navigate to={'/examen/' + sesionId} replace />
  if (!datos) return <EstadoParticipante {...estado} />
  if (datos.intento.estado !== 'en_curso') return <Navigate to={rutaIntento(sesionId, datos.intento.estado)} replace />
  if (datos.acceso?.pendiente) return <AccesoPendiente datos={datos} aplicar={estado.aplicar} />
  if (!datos.pregunta) return <EstadoParticipante error="No se encontró la pregunta pendiente. Intenta reconectar." recargar={recargar} />
  const segundos = Math.max(0, Math.ceil((restante || 0) / 1000))
  return <main className="joven-examen">
    <header className="joven-examen-header"><div><p className="joven-libro">{datos.etapa.libro} · {datos.sesion.sociedad}</p><strong>{datos.participante.nombre}</strong><p>Pregunta {datos.pregunta.posicion} de {datos.intento.total}</p></div><div className="joven-reloj" aria-label="Tiempo restante"><Clock size={19} /><span>{restante === null ? '—:—' : Math.floor(segundos/60) + ':' + String(segundos%60).padStart(2,'0')}</span></div></header>
    <div className="joven-examen-content">
      <div className="joven-progreso"><span style={{ width: (datos.intento.respondidas / datos.intento.total * 100) + '%' }} /></div>
      {estado.error && <p className="alert alert-warning" role="status">Intentando reconectar. Puedes seguir escribiendo; espera la confirmación para avanzar.</p>}
      {aviso && <div className="alert alert-warning" role="status"><span>Tu progreso se conserva. Mantén el examen visible mientras respondes.</span><button className="btn btn-secondary" onClick={() => setAviso(false)}>Continuar</button></div>}
      <button className="joven-fullscreen" onClick={pantallaCompleta}><Maximize size={16} />Pantalla completa</button>
      <details className="joven-ayuda-examen"><summary>Ayuda para responder y guardar</summary><InstruccionesExamen compacto /></details>
      <Pregunta key={datos.pregunta.id} pregunta={datos.pregunta} intento={datos.intento} aplicar={estado.aplicar} />
    </div>
    <AdvertenciaOverlay isOpen={overlay} onContinuar={pantallaCompleta} />
  </main>
}
