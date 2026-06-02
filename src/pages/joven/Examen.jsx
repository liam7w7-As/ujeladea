import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { calcularPuntajeAutomatico } from '../../lib/examen'
import { SeguridadExamen } from '../../lib/seguridad'
import { Clock, ArrowRight, Check, AlertTriangle } from 'lucide-react'
import Modal from '../../components/Modal'
import AdvertenciaOverlay from '../../components/AdvertenciaOverlay'

export default function Examen() {
  const { sesionId } = useParams()
  const navigate = useNavigate()
  
  const [participante, setParticipante] = useState(null)
  const [sesion, setSesion] = useState(null)
  const [preguntas, setPreguntas] = useState([])
  const [indiceActual, setIndiceActual] = useState(0)
  
  // Respuestas
  const [respuestaActual, setRespuestaActual] = useState('')
  const [guardando, setGuardando] = useState(false)
  
  // Estados generales
  const [cargando, setCargando] = useState(true)
  const [tiempoRestante, setTiempoRestante] = useState(null)
  const [modal, setModal] = useState({ isOpen: false, titulo: '', mensaje: '', tipo: 'info' })
  
  // Seguridad
  const [advertencias, setAdvertencias] = useState(0)
  const [mostrarOverlay, setMostrarOverlay] = useState(false)

  useEffect(() => {
    const partId = localStorage.getItem(`torneo_participante_${sesionId}`)
    const ordenIdsJson = localStorage.getItem(`torneo_preguntas_${sesionId}`)
    
    if (!partId) {
      navigate(`/examen/${sesionId}`)
      return
    }

    if (!ordenIdsJson) {
      navigate(`/examen/${sesionId}/espera`)
      return
    }

    cargarDatosYPreguntas(partId, JSON.parse(ordenIdsJson))
  }, [sesionId, navigate])

  const cargarDatosYPreguntas = async (partId, ordenIds) => {
    try {
      // 1. Cargar participante
      const { data: dataPart, error: errPart } = await supabase
        .from('participantes')
        .select('*')
        .eq('id', partId)
        .single()
      
      if (errPart || !dataPart) throw new Error('Participante no encontrado')
      if (dataPart.examen_finalizado) {
        navigate(`/examen/${sesionId}/finalizado`)
        return
      }
      setParticipante(dataPart)

      // 2. Cargar sesión
      const { data: dataSesion, error: errSesion } = await supabase
        .from('sesiones')
        .select('*')
        .eq('id', sesionId)
        .single()
      
      if (errSesion) throw errSesion
      if (dataSesion.estado === 'finalizado') {
        terminarExamenPorTiempo(partId)
        return
      }
      setSesion(dataSesion)

      // 3. Cargar las preguntas en el orden asignado
      const { data: dataPreguntas, error: errPreguntas } = await supabase
        .from('preguntas')
        .select('*')
        .in('id', ordenIds)

      if (errPreguntas) throw errPreguntas

      // Ordenar las preguntas localmente según el array ordenIds
      const preguntasOrdenadas = ordenIds.map(id => dataPreguntas.find(p => p.id === id)).filter(Boolean)
      
      // Buscar en qué pregunta va (contando respuestas guardadas)
      const { count, error: errCount } = await supabase
        .from('respuestas')
        .select('*', { count: 'exact', head: true })
        .eq('participante_id', partId)
        .eq('sesion_id', sesionId) // asumiendo que la tabla respuestas podría necesitar este cruce, o por lógica ya están asociadas.

      // Solo saltamos al índice según la cantidad de respuestas dadas.
      // Así evitamos que si recargan, vuelvan a contestar la pregunta 1.
      const respondidas = count || 0
      if (respondidas >= preguntasOrdenadas.length) {
        // Ya terminó todas las preguntas pero tal vez cerró antes de marcar finalizado
        await finalizarExamenCompleto(partId)
        return
      }

      setIndiceActual(respondidas)
      setPreguntas(preguntasOrdenadas)
      setCargando(false)

      // 4. Suscribirse a cierre forzado de sesión
      const canalId = `sesion_examen_${sesionId}_${Math.random().toString(36).substring(7)}`
      const canalSesion = supabase.channel(canalId)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sesiones', filter: `id=eq.${sesionId}` }, (payload) => {
          if (payload.new.estado === 'finalizado') {
            terminarExamenPorTiempo(partId)
          }
        })
        .subscribe()

      return () => supabase.removeChannel(canalSesion)

    } catch (err) {
      console.error(err)
      setModal({ isOpen: true, titulo: 'Error', mensaje: 'Error al cargar el examen.', tipo: 'error' })
    }
  }

  // Lógica de temporizador local
  useEffect(() => {
    if (!sesion || !sesion.iniciado_at) return
    
    const calcularTiempo = () => {
      const inicio = new Date(sesion.iniciado_at).getTime()
      const ahora = new Date().getTime()
      const limiteMs = sesion.tiempo_limite * 60 * 1000
      
      const restante = limiteMs - (ahora - inicio)
      if (restante <= 0) {
        setTiempoRestante(0)
        terminarExamenPorTiempo(participante.id)
      } else {
        setTiempoRestante(restante)
      }
    }

    calcularTiempo()
    const intervalo = setInterval(calcularTiempo, 1000)
    return () => clearInterval(intervalo)
  }, [sesion, participante])

  // Lógica de seguridad anti-trampa
  useEffect(() => {
    if (!participante || !sesion || sesion.estado === 'finalizado') return
    
    const seguridad = new SeguridadExamen(participante.id, sesionId, supabase, (tipo, cantidad) => {
      setAdvertencias(cantidad)
      
      if (tipo === 'salio_fullscreen') {
        setMostrarOverlay(true)
      } else if (tipo === 'cambio_pestana') {
        setTimeout(() => {
          // Mostrar modal sutil
          setModal({ 
            isOpen: true, 
            titulo: 'Advertencia de Seguridad', 
            mensaje: `⚠️ Se registró que saliste de la pestaña o minimizaste el examen. Este evento fue notificado al jurado.`, 
            tipo: 'warning' 
          })
        }, 1000)
      }
    })
    
    seguridad.iniciar()
    return () => seguridad.destruir()
  }, [participante, sesion, sesionId])

  const handleContinuarExamen = async () => {
    setMostrarOverlay(false)
    if (document.fullscreenEnabled) {
      try {
        await document.documentElement.requestFullscreen()
      } catch (err) {
        console.warn("Fullscreen no pudo restaurarse", err)
      }
    }
  }

  const terminarExamenPorTiempo = async (partId) => {
    // Marcar como finalizado y redirigir (se calculará el total en DB o se deja con lo que haya respondido)
    await actualizarPuntajeYFinalizar(partId)
    navigate(`/examen/${sesionId}/finalizado`)
  }

  const actualizarPuntajeYFinalizar = async (partId) => {
    try {
      // Sumar puntajes de las respuestas dadas (solo automáticas)
      const { data: respuestas, error: errR } = await supabase
        .from('respuestas')
        .select('puntaje_obtenido')
        .eq('participante_id', partId)
      
      let suma = 0
      if (!errR && respuestas) {
        suma = respuestas.reduce((acc, r) => acc + (r.puntaje_obtenido || 0), 0)
      }

      await supabase
        .from('participantes')
        .update({ 
          examen_finalizado: true,
          puntaje_total: suma
        })
        .eq('id', partId)

    } catch (error) {
      console.error("Error al finalizar participante:", error)
    }
  }

  const finalizarExamenCompleto = async (partId) => {
    setGuardando(true)
    await actualizarPuntajeYFinalizar(partId)
    navigate(`/examen/${sesionId}/finalizado`)
  }

  const handleSiguiente = async () => {
    if (!respuestaActual.trim()) return
    
    setGuardando(true)
    const preguntaObj = preguntas[indiceActual]
    
    // Calcular puntaje
    const evaluacion = calcularPuntajeAutomatico(preguntaObj, respuestaActual)

    try {
      // Guardar respuesta
      const { error } = await supabase
        .from('respuestas')
        .insert([{
          participante_id: participante.id,
          pregunta_id: preguntaObj.id,
          respuesta_dada: respuestaActual,
          es_correcta: evaluacion.es_correcta,
          puntaje_obtenido: evaluacion.puntaje_obtenido,
          calificado_por: evaluacion.calificado_por
        }])

      if (error) throw error

      setRespuestaActual('')

      // ¿Es la última?
      if (indiceActual === preguntas.length - 1) {
        await finalizarExamenCompleto(participante.id)
      } else {
        setIndiceActual(indiceActual + 1)
        setGuardando(false)
      }

    } catch (err) {
      console.error(err)
      setModal({ isOpen: true, titulo: 'Error', mensaje: 'Error al guardar la respuesta. Intenta de nuevo.', tipo: 'error' })
      setGuardando(false)
    }
  }

  const formatoTiempo = (ms) => {
    if (ms === null) return '--:--'
    const totalSegundos = Math.floor(ms / 1000)
    const minutos = Math.floor(totalSegundos / 60)
    const segundos = totalSegundos % 60
    return `${minutos.toString().padStart(2, '0')}:${segundos.toString().padStart(2, '0')}`
  }

  if (cargando) return <div className="page-wrapper"><div className="spinner" /></div>
  
  const pregunta = preguntas[indiceActual]
  if (!pregunta) return <div className="page-wrapper"><div className="spinner" /></div>

  let opciones = []
  if (pregunta.tipo === 'multiple' && pregunta.opciones) {
    try {
      let rawOps = typeof pregunta.opciones === 'string' ? JSON.parse(pregunta.opciones) : pregunta.opciones
      if (!Array.isArray(rawOps)) rawOps = []
      
      // Asegurarse de que sea un array de strings (soporte para datos antiguos)
      opciones = rawOps.map(op => typeof op === 'object' && op !== null ? (op.texto || '') : String(op))
    } catch (e) {
      console.error("Error al leer las opciones", e)
      opciones = []
    }
  }

  return (
    <div className="page-wrapper" style={{ padding: 0, justifyContent: 'flex-start', minHeight: '100dvh', background: 'var(--color-bg-deep)' }}>
      <AdvertenciaOverlay isOpen={mostrarOverlay} onContinuar={handleContinuarExamen} />
      
      {/* Header Fijo */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--color-bg-raised)', borderBottom: '1px solid var(--color-border)', padding: 'var(--space-md) var(--space-lg)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: 'var(--shadow-md)' }}>
        <div>
          <div style={{ fontSize: '1rem', fontWeight: 600 }}>{participante?.nombre}</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--color-accent)' }}>Pregunta {indiceActual + 1} de {preguntas.length}</div>
        </div>
        
        <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
          {advertencias > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(231, 76, 60, 0.1)', color: 'var(--color-error)', padding: '6px 12px', borderRadius: 'var(--radius-xl)', border: '1px solid rgba(231, 76, 60, 0.2)' }}>
              <AlertTriangle size={16} />
              <span className="hide-mobile" style={{ fontSize: '0.85rem', fontWeight: 600 }}>{advertencias} alertas</span>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--color-bg-base)', padding: '6px 12px', borderRadius: 'var(--radius-xl)', border: `1px solid ${tiempoRestante < 60000 ? 'var(--color-error)' : 'var(--color-border)'}` }}>
            <Clock size={16} color={tiempoRestante < 60000 ? 'var(--color-error)' : 'var(--color-text-muted)'} />
            <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: '1.1rem', color: tiempoRestante < 60000 ? 'var(--color-error)' : 'var(--color-text-primary)' }}>
              {formatoTiempo(tiempoRestante)}
            </span>
          </div>
        </div>
      </div>

      {/* Contenido de la Pregunta */}
      <div className="page-content animate-in" style={{ padding: 'var(--space-2xl) var(--space-lg) 120px var(--space-lg)', maxWidth: '800px', margin: '0 auto', width: '100%' }}>
        
        <div className="card" style={{ marginBottom: 'var(--space-xl)' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 'var(--space-sm)' }}>
            {pregunta.tipo === 'multiple' ? 'Opción Múltiple' : (pregunta.tipo === 'abierta' ? 'Pregunta Abierta' : 'Pregunta de Contexto')}
          </div>
          <h2 style={{ fontSize: '1.5rem', lineHeight: 1.4, marginBottom: 'var(--space-sm)' }}>
            {pregunta.texto}
          </h2>
          <div style={{ fontSize: '0.85rem', color: 'var(--color-accent)', fontWeight: 600 }}>
            Valor: {pregunta.puntaje} pts
          </div>
        </div>

        {/* Opciones o Textarea */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', marginBottom: 'var(--space-2xl)' }}>
          {pregunta.tipo === 'multiple' ? (
            opciones.map((opc, idx) => {
              const letra = String.fromCharCode(65 + idx) // A, B, C, D...
              const seleccionada = respuestaActual === opc
              
              return (
                <button
                  key={idx}
                  onClick={() => setRespuestaActual(opc)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-md)',
                    padding: '16px',
                    width: '100%',
                    background: seleccionada ? 'var(--color-primary-glow)' : 'var(--color-bg-base)',
                    border: `2px solid ${seleccionada ? 'var(--color-primary)' : 'var(--color-border)'}`,
                    borderRadius: 'var(--radius-md)',
                    color: 'var(--color-text-primary)',
                    fontFamily: 'var(--font-body)',
                    fontSize: '1.1rem',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    textAlign: 'left'
                  }}
                >
                  <div style={{ 
                    width: '32px', height: '32px', 
                    borderRadius: '50%', 
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: seleccionada ? 'var(--color-primary)' : 'var(--color-bg-raised)',
                    color: seleccionada ? 'white' : 'var(--color-text-muted)',
                    fontWeight: 600,
                    fontSize: '0.9rem'
                  }}>
                    {letra}
                  </div>
                  <div style={{ flex: 1 }}>{opc}</div>
                  {seleccionada && <Check size={20} color="var(--color-primary)" />}
                </button>
              )
            })
          ) : (
            <div style={{ position: 'relative' }}>
              <textarea
                className="form-input"
                placeholder="Escribe tu respuesta aquí..."
                value={respuestaActual}
                onChange={e => setRespuestaActual(e.target.value)}
                maxLength={500}
                style={{ minHeight: '200px', resize: 'vertical', fontSize: '1.1rem', lineHeight: 1.5 }}
              />
              <div style={{ position: 'absolute', bottom: '16px', right: '16px', fontSize: '0.8rem', color: respuestaActual.length > 450 ? 'var(--color-warning)' : 'var(--color-text-muted)' }}>
                {respuestaActual.length} / 500
              </div>
            </div>
          )}
        </div>

      </div>
      
      {/* Footer Fijo con Botón Siguiente */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'var(--color-bg-raised)', borderTop: '1px solid var(--color-border)', padding: 'var(--space-md) var(--space-lg)', display: 'flex', justifyContent: 'center', boxShadow: '0 -4px 16px rgba(0,0,0,0.3)', zIndex: 100 }}>
        <div style={{ width: '100%', maxWidth: '800px', display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={handleSiguiente}
            disabled={!respuestaActual.trim() || guardando}
            className="btn btn-primary"
            style={{ padding: '1rem 2rem', fontSize: '1.1rem' }}
          >
            {guardando ? (
              <><span className="spinner"/> Guardando...</>
            ) : indiceActual === preguntas.length - 1 ? (
              <><Check size={20}/> Finalizar Examen</>
            ) : (
              <>Siguiente Pregunta <ArrowRight size={20} /></>
            )}
          </button>
        </div>
      </div>

      <Modal 
        isOpen={modal.isOpen} 
        onClose={() => setModal(prev => ({ ...prev, isOpen: false }))} 
        titulo={modal.titulo} 
        mensaje={modal.mensaje} 
        tipo={modal.tipo} 
      />
    </div>
  )
}
