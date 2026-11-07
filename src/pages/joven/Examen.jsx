import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { ArrowRight, Check, Clock, CloudCheck, CloudUpload, HelpCircle, Maximize } from 'lucide-react'
import useIntento from '../../hooks/useIntento'
import { apiExamen } from '../../lib/participante-supabase'
import { rutaIntento } from '../../lib/estado-examen'
import { estadoGuardado, separarContexto } from '../../lib/experiencia-examen'
import { BorradorExamen } from '../../lib/borradores'
import { SeguridadExamen } from '../../lib/seguridad'
import EstadoParticipante from '../../components/EstadoParticipante'
import AccesoPendiente from '../../components/AccesoPendiente'
import AdvertenciaOverlay from '../../components/AdvertenciaOverlay'
import AyudaExamen from '../../components/AyudaExamen'
import Modal from '../../components/Modal'
import InstruccionesExamen from '../../components/InstruccionesExamen'

function Pregunta({ pregunta, intento, aplicar }) {
  const [entrega, setEntrega] = useState(false)
  const titulo = useRef(null)
  const [gestor] = useState(() => {
    let storage = null
    try { storage = globalThis.localStorage } catch { /* Algunos navegadores impiden acceder a la copia local. */ }
    return new BorradorExamen({ api: apiExamen, intento: intento.id, pregunta, storage, onEstado: aplicar })
  })
  const borrador = useSyncExternalStore(gestor.subscribe, gestor.getSnapshot)
  useEffect(() => {
    gestor.iniciar()
    const online = () => { void gestor.reintentar() }
    window.addEventListener('online', online)
    return () => { window.removeEventListener('online', online); gestor.destruir() }
  }, [gestor])
  useEffect(() => { gestor.sincronizar(pregunta) }, [gestor, pregunta])
  useEffect(() => {
    titulo.current?.focus({ preventScroll: true })
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [])
  const enviando = borrador.estado === 'enviando'
  const bloqueado = enviando || borrador.estado === 'pendiente'
  const guardado = estadoGuardado(borrador)
  const { contexto, consigna } = separarContexto(pregunta.texto, pregunta.tipo)
  const escrita = pregunta.tipo !== 'multiple'
  return <section className="joven-pregunta" aria-labelledby="pregunta-titulo">
    <div className="card joven-enunciado">
      <p className="eyebrow">{pregunta.tipo === 'multiple' ? 'Opción múltiple' : pregunta.tipo === 'contexto' ? 'Contexto bíblico' : 'Respuesta abierta'} · {pregunta.puntaje} puntos</p>
      {contexto && <div className="joven-pasaje" aria-label="Pasaje de la pregunta"><span>Lee el contexto</span><p>{contexto}</p></div>}
      <h1 id="pregunta-titulo" ref={titulo} tabIndex={-1}>{consigna}</h1>
      <p className="joven-consigna">{!escrita ? 'Selecciona una opción y revísala antes de confirmar.' : pregunta.tipo === 'contexto' ? 'Lee con atención y responde relacionando tu explicación con el contexto de la pregunta.' : 'Responde lo que pide la pregunta. Puedes organizar tu explicación en varios párrafos.'}</p>
    </div>
    {!escrita ? <div className="joven-opciones" role="group" aria-label="Opciones de respuesta">{pregunta.opciones.map((opcion, i) => <button key={i} disabled={bloqueado} className={borrador.texto === opcion ? 'seleccionada' : ''} aria-pressed={borrador.texto === opcion} onClick={() => gestor.cambiar(opcion)}><span aria-hidden="true">{String.fromCharCode(65 + i)}</span><span className="joven-opcion-texto">{opcion}</span>{borrador.texto === opcion && <Check size={20} aria-hidden="true" />}</button>)}</div> :
      <div className={'joven-respuesta ' + (pregunta.tipo === 'contexto' ? 'respuesta-contexto' : '')}><label className="form-label" htmlFor="respuesta-escrita">Tu respuesta</label><p id="respuesta-orientacion">Puedes usar varios párrafos. El límite es de 2000 caracteres.</p><textarea id="respuesta-escrita" aria-describedby="respuesta-orientacion respuesta-caracteres" className="form-input" rows={pregunta.tipo === 'contexto' ? 10 : 8} value={borrador.texto} disabled={bloqueado} onChange={e => gestor.cambiar(e.target.value)} maxLength={2000} placeholder={pregunta.tipo === 'contexto' ? 'Desarrolla aquí tu explicación del contexto…' : 'Escribe aquí tu respuesta…'} /><small id="respuesta-caracteres">{borrador.texto.length} / 2000 caracteres</small></div>}
    <div className="joven-siguiente"><div className="joven-resumen-guardado">
      <div className={'joven-guardado ' + guardado.tono} role="status" aria-live="polite" aria-atomic="true">
        <div className="joven-guardado-titulo">{guardado.tono === 'correcto' ? <CloudCheck size={17} aria-hidden="true" /> : <CloudUpload size={17} aria-hidden="true" />}<strong>{guardado.titulo}</strong></div><p>{guardado.detalle}</p>
        {borrador.estado === 'conflicto' ? <div className="etapa-actions"><button className="btn btn-secondary" onClick={() => gestor.usarGuardado()}>Usar el borrador del servidor</button><button className="btn btn-secondary" onClick={() => gestor.conservarLocal()}>Conservar mi texto de esta pantalla</button></div> : ['error', 'pendiente'].includes(borrador.estado) && <button className="btn btn-secondary" onClick={() => gestor.reintentar()}>Reintentar guardado</button>}
      </div>
      <p className="joven-confirmacion-nota">Al confirmar, esta respuesta será definitiva.</p>
    </div><button className="btn btn-primary" disabled={!borrador.texto.trim() || enviando || borrador.estado === 'conflicto'} onClick={() => pregunta.posicion === intento.total && borrador.estado !== 'pendiente' ? setEntrega(true) : gestor.confirmar()}>{enviando ? 'Confirmando…' : borrador.estado === 'pendiente' ? 'Reintentar confirmación' : pregunta.posicion === intento.total ? 'Confirmar y finalizar' : 'Confirmar y continuar'}<ArrowRight size={18} aria-hidden="true" /></button></div>
    <Modal isOpen={entrega} onClose={() => setEntrega(false)} titulo="Entregar evaluación" mensaje={'Se confirmará tu última respuesta y se entregará el examen de ' + intento.total + ' preguntas. Después de entregar no podrás editar tus respuestas.'} isConfirm textoConfirmar="Confirmar entrega" onConfirm={() => { setEntrega(false); void gestor.confirmar() }} />
  </section>
}

export default function Examen() {
  const { sesionId } = useParams()
  const estado = useIntento(sesionId)
  const [restante, setRestante] = useState(null)
  const [overlay, setOverlay] = useState(() => Boolean(document.fullscreenEnabled && !document.fullscreenElement))
  const [pantallaPreparada, setPantallaPreparada] = useState(() => Boolean(document.fullscreenElement) || !document.fullscreenEnabled)
  const [aviso, setAviso] = useState('')
  const menuAyuda = useRef(null)
  const datos = estado.datos
  const { recargar, aplicar } = estado
  const vence = datos?.intento.vence_at
  const servidor = datos?.servidor_at
  useEffect(() => {
    const cerrarFuera = e => { if (menuAyuda.current?.open && !menuAyuda.current.contains(e.target)) menuAyuda.current.open = false }
    const cerrarEscape = e => { if (e.key === 'Escape' && !document.querySelector('dialog[open]') && menuAyuda.current) menuAyuda.current.open = false }
    document.addEventListener('pointerdown', cerrarFuera)
    document.addEventListener('keydown', cerrarEscape)
    return () => { document.removeEventListener('pointerdown', cerrarFuera); document.removeEventListener('keydown', cerrarEscape) }
  }, [])
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
    let vigente = true
    const seguridad = new SeguridadExamen({ intento: intentoId, reportar: apiExamen.eventos, supervisar: async e => { const d = await apiExamen.supervisar(intentoId, e); if (vigente) aplicar(d) }, onAdvertencia: tipo => {
      if (tipo === 'salio_fullscreen') setOverlay(true)
      else setAviso(tipo === 'vista_reducida' ? 'La vista del examen se redujo. Vuelve a la vista completa; si ocurre por un problema del dispositivo, avisa al moderador. Esta señal requiere interpretación.' : 'El examen perdió visibilidad o foco. Regresa a esta pantalla. Si la interrupción se prolonga, necesitarás autorización del moderador. Tu progreso se conserva.')
    } })
    seguridad.iniciar()
    return () => { vigente = false; seguridad.destruir() }
  }, [intentoId, estadoIntento, datos?.acceso?.pendiente, aplicar])
  async function pantallaCompleta() {
    setOverlay(false)
    setPantallaPreparada(true)
    try { if (document.fullscreenEnabled && !document.fullscreenElement) await document.documentElement.requestFullscreen() }
    catch { setAviso('No pudimos activar la pantalla completa. Conserva esta pantalla abierta y avisa al moderador.'); void apiExamen.supervisar(intentoId, { episodio: crypto.randomUUID(), fase: 'fin', senales: ['pantalla_completa_no_disponible'], duracion: 0 }).catch(() => {}) }
  }
  if (estado.sinIntento) return <Navigate to={'/examen/' + sesionId} replace />
  if (!datos) return <EstadoParticipante {...estado} />
  if (datos.intento.estado !== 'en_curso') return <Navigate to={rutaIntento(sesionId, datos.intento.estado)} replace />
  if (datos.acceso?.pendiente) return <AccesoPendiente datos={datos} aplicar={estado.aplicar} errorConexion={estado.error} recargar={recargar} />
  if (!datos.pregunta) return <EstadoParticipante error="No se encontró la pregunta pendiente. Intenta reconectar." recargar={recargar} />
  const segundos = Math.max(0, Math.ceil((restante || 0) / 1000))
  const pocoTiempo = restante !== null && segundos <= 300
  const mensajeTiempo = restante === null || segundos > 300 ? '' : segundos === 0 ? 'El tiempo terminó. Estamos comprobando la entrega con el servidor.' : segundos <= 60 ? 'Queda un minuto o menos. Revisa y confirma tu respuesta; el cierre es común para toda la sala.' : 'Quedan cinco minutos o menos. Continúa a tu ritmo y comprueba el guardado.'
  return <main className="joven-examen">
    <header className="joven-examen-header"><div className="joven-cabecera-identidad"><p className="joven-libro">{datos.etapa.libro}</p><strong>Pregunta {datos.pregunta.posicion} de {datos.intento.total}</strong></div>
      <div className={'joven-reloj' + (pocoTiempo ? ' tiempo-corto' : '')} aria-label="Tiempo restante"><Clock size={18} aria-hidden="true" /><span>{restante === null ? '—:—' : Math.floor(segundos / 60) + ':' + String(segundos % 60).padStart(2, '0')}</span></div>
      <details className="joven-menu-ayuda" ref={menuAyuda}><summary><HelpCircle size={20} aria-hidden="true" /><span>Ayuda</span></summary><div className="joven-menu-contenido"><p><strong>{datos.participante.nombre}</strong><br />{datos.sesion.sociedad}</p><button className="btn btn-secondary" onClick={pantallaCompleta}><Maximize size={16} aria-hidden="true" />Pantalla completa</button><AyudaExamen datos={datos} aplicar={estado.aplicar} /><details className="joven-ayuda-examen"><summary>Ayuda para responder y guardar</summary><InstruccionesExamen compacto /></details></div></details>
    </header>
    <div className="joven-examen-content">
      <div className="joven-progreso-info"><span role="status" aria-live="polite">{datos.intento.respondidas} de {datos.intento.total} respuestas confirmadas</span></div>
      <div className="joven-progreso" role="progressbar" aria-label="Respuestas confirmadas" aria-valuemin={0} aria-valuemax={datos.intento.total} aria-valuenow={datos.intento.respondidas}><span style={{ width: (datos.intento.respondidas / datos.intento.total * 100) + '%' }} /></div>
      <p className="joven-tiempo-aviso" role="status" aria-live="polite">{mensajeTiempo}</p>
      {estado.error && <p className="alert alert-warning" role="status">Intentando reconectar. Puedes seguir escribiendo; espera la confirmación para avanzar.</p>}
      {aviso && <div className="alert alert-warning joven-aviso" role="status"><span>{aviso}</span><button className="btn btn-secondary" onClick={() => setAviso('')}>Continuar</button></div>}
      {datos.ayuda && !datos.ayuda.atendida_at && <p className="joven-ayuda-pendiente" role="status">Tu solicitud de ayuda está registrada. Conserva la pantalla abierta y avisa al moderador.</p>}
      <Pregunta key={datos.pregunta.id} pregunta={datos.pregunta} intento={datos.intento} aplicar={estado.aplicar} />
    </div>
    <AdvertenciaOverlay inicial={!pantallaPreparada} isOpen={overlay} onContinuar={pantallaCompleta} />
  </main>
}
