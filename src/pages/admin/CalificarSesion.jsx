import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { calificarRespuestaAbierta } from '../../lib/ai'
import { ArrowLeft, Brain, Check, X, AlertCircle, ChevronDown, ChevronUp, Bot, Save } from 'lucide-react'
import Modal from '../../components/Modal'
import NavAdmin from '../../components/NavAdmin'

export default function CalificarSesion() {
  const { id } = useParams()
  const navigate = useNavigate()
  
  const [sesion, setSesion] = useState(null)
  const [respuestas, setRespuestas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [modal, setModal] = useState({ isOpen: false, titulo: '', mensaje: '', tipo: 'info', onConfirm: null, isConfirm: false })
  
  // Estado de auto-calificación
  const [procesandoGlobal, setProcesandoGlobal] = useState(false)
  const [progreso, setProgreso] = useState({ actual: 0, total: 0 })
  const [evaluacionesIa, setEvaluacionesIa] = useState({}) // { respId: { puntaje, justificacion, es_correcta, cargando } }
  
  // Estado UI
  const [referenciasVisibles, setReferenciasVisibles] = useState({}) // { respId: boolean }
  const [edicionManual, setEdicionManual] = useState({}) // { respId: puntaje }

  useEffect(() => {
    cargarDatos()
  }, [id])

  const cargarDatos = async () => {
    try {
      setCargando(true)
      // 1. Cargar sesión
      const { data: dataSesion, error: errSesion } = await supabase
        .from('sesiones')
        .select('*, sociedades(nombre)')
        .eq('id', id)
        .single()
      
      if (errSesion) throw errSesion
      setSesion(dataSesion)

      // 2. Cargar TODAS las respuestas pendientes de corrección de esta sesión
      // Necesitamos cruzar con participantes y preguntas
      const { data: dataResp, error: errResp } = await supabase
        .from('respuestas')
        .select(`
          id, respuesta_dada, calificado_por, participante_id, pregunta_id,
          participantes!inner (nombre, sesion_id),
          preguntas!inner (texto, respuesta_correcta, puntaje, tipo)
        `)
        .eq('calificado_por', 'pendiente_ia')
        .eq('participantes.sesion_id', id)

      if (errResp) throw errResp
      
      // Limpiar estructura para que sea más fácil de usar
      const pendientes = dataResp.map(r => ({
        id: r.id,
        respuesta_dada: r.respuesta_dada,
        participante_id: r.participante_id,
        participante_nombre: r.participantes.nombre,
        pregunta_id: r.pregunta_id,
        pregunta_texto: r.preguntas.texto,
        pregunta_referencia: r.preguntas.respuesta_correcta,
        pregunta_puntaje_max: r.preguntas.puntaje,
        pregunta_tipo: r.preguntas.tipo
      }))

      setRespuestas(pendientes)
      
    } catch (err) {
      setError('Error al cargar datos pendientes: ' + err.message)
    } finally {
      setCargando(false)
    }
  }

  const toggleReferencia = (respId) => {
    setReferenciasVisibles(prev => ({ ...prev, [respId]: !prev[respId] }))
  }

  const solicitarEvaluacionIndividual = async (resp) => {
    setEvaluacionesIa(prev => ({ ...prev, [resp.id]: { cargando: true } }))
    
    const preguntaMock = { texto: resp.pregunta_texto, puntaje: resp.pregunta_puntaje_max }
    const res = await calificarRespuestaAbierta(preguntaMock, resp.pregunta_referencia, resp.respuesta_dada)
    
    setEvaluacionesIa(prev => ({ ...prev, [resp.id]: { ...res, cargando: false } }))
  }

  const pedirProcesarTodas = () => {
    if (respuestas.length === 0) return
    setModal({
      isOpen: true,
      titulo: 'Confirmación',
      mensaje: `¿Estás seguro de enviar ${respuestas.length} respuestas al sistema automático? Esto tomará unos segundos.`,
      tipo: 'warning',
      isConfirm: true,
      onConfirm: () => {
        setModal(prev => ({ ...prev, isOpen: false }))
        procesarTodasReal()
      }
    })
  }

  const procesarTodasReal = async () => {
    setProcesandoGlobal(true)
    setProgreso({ actual: 0, total: respuestas.length })

    for (let i = 0; i < respuestas.length; i++) {
      const resp = respuestas[i]
      
      // Si ya tiene evaluación, saltar (a menos que quieras forzar)
      if (!evaluacionesIa[resp.id] || evaluacionesIa[resp.id].cargando) {
        setProgreso({ actual: i + 1, total: respuestas.length })
        await solicitarEvaluacionIndividual(resp)
        // Pequeño delay de 1.5s para no saturar el servicio si hay muchas
        await new Promise(resolve => setTimeout(resolve, 1500))
      }
    }

    setProcesandoGlobal(false)
  }

  const confirmarCalificacion = async (respId, puntajeFinal, esCorrectaFinal, metodo) => {
    try {
      // 1. Buscar la respuesta original en nuestro array local
      const resp = respuestas.find(r => r.id === respId)
      if (!resp) return

      // 2. Actualizar en Supabase (tabla respuestas)
      const { error: errResp } = await supabase
        .from('respuestas')
        .update({
          puntaje_obtenido: puntajeFinal,
          es_correcta: esCorrectaFinal,
          calificado_por: metodo // 'ia' o 'manual'
        })
        .eq('id', respId)

      if (errResp) throw errResp

      // 3. Obtener el puntaje actual del participante para sumarle
      const { data: pData, error: errGetP } = await supabase
        .from('participantes')
        .select('puntaje_total')
        .eq('id', resp.participante_id)
        .single()
      
      if (errGetP) throw errGetP

      // 4. Sumar el nuevo puntaje al total
      const { error: errSetP } = await supabase
        .from('participantes')
        .update({ puntaje_total: (pData.puntaje_total || 0) + puntajeFinal })
        .eq('id', resp.participante_id)

      if (errSetP) throw errSetP

      // 5. Quitar de la lista local
      setRespuestas(respuestas.filter(r => r.id !== respId))
      
      // Limpiar estados locales para esa respuesta
      setEvaluacionesIa(prev => { const n = {...prev}; delete n[respId]; return n; })
      setEdicionManual(prev => { const n = {...prev}; delete n[respId]; return n; })
      
    } catch (err) {
      setModal({ isOpen: true, titulo: 'Error', mensaje: 'Error al guardar la calificación: ' + err.message, tipo: 'error', isConfirm: false })
    }
  }

  const handleAceptarIA = (respId) => {
    const evaluacion = evaluacionesIa[respId]
    if (!evaluacion) return
    confirmarCalificacion(respId, evaluacion.puntaje, evaluacion.es_correcta, 'ia')
  }

  const handleGuardarManual = (respId) => {
    const puntajeTxt = edicionManual[respId]
    if (puntajeTxt === undefined || puntajeTxt === '') return
    
    const puntajeNum = Number(puntajeTxt)
    const resp = respuestas.find(r => r.id === respId)
    if (!resp) return

    // Validar max
    if (puntajeNum < 0 || puntajeNum > resp.pregunta_puntaje_max) {
      setModal({ isOpen: true, titulo: 'Atención', mensaje: `El puntaje debe estar entre 0 y ${resp.pregunta_puntaje_max}`, tipo: 'warning', isConfirm: false })
      return
    }

    const esCorrecta = puntajeNum > 0 // simplificación
    confirmarCalificacion(respId, puntajeNum, esCorrecta, 'manual')
  }

  // Verificar cuántas respuestas ya tienen sugerencia de IA lista
  const respuestasConSugerencia = respuestas.filter(r => evaluacionesIa[r.id] && !evaluacionesIa[r.id].cargando)
  const todasEvaluadas = respuestasConSugerencia.length === respuestas.length && respuestas.length > 0
  const hayAlgunaSugerencia = respuestasConSugerencia.length > 0

  const [aceptandoTodas, setAceptandoTodas] = useState(false)
  const handleAceptarTodasIA = async () => {
    setAceptandoTodas(true)
    // Copiar las respuestas con sugerencia para iterar de forma segura
    const paraGuardar = respuestasConSugerencia.map(r => ({
      id: r.id,
      puntaje: evaluacionesIa[r.id].puntaje,
      es_correcta: evaluacionesIa[r.id].es_correcta
    }))

    for (const item of paraGuardar) {
      await confirmarCalificacion(item.id, item.puntaje, item.es_correcta, 'ia')
    }
    setAceptandoTodas(false)
  }

  if (cargando) return <div className="page-wrapper"><div className="spinner" /></div>

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <NavAdmin />
      <div className="page-wrapper" style={{ padding: 'var(--space-md)', flex: 1, alignItems: 'flex-start' }}>
        <div className="page-content animate-in" style={{ maxWidth: '900px', width: '100%', margin: '0 auto' }}>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-xl)', flexWrap: 'wrap', gap: 'var(--space-md)' }}>
            <div>
              <h1 className="brand-title" style={{ fontSize: '2rem', marginBottom: 'var(--space-xs)', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <Brain color="var(--color-accent)" size={32} />
                Centro de Evaluación
              </h1>
              <p style={{ color: 'var(--color-text-muted)' }}>Módulo de corrección de preguntas abiertas</p>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Progreso General</div>
                <div style={{ fontWeight: 600 }}>{progreso.actual} / {progreso.total}</div>
              </div>
              <p style={{ color: 'var(--color-accent)', fontSize: '0.9rem' }}>{sesion?.sociedades?.nombre}</p>
            </div>
          </div>

          {respuestas.length > 0 && (
            <div style={{ display: 'flex', gap: 'var(--space-md)', flexWrap: 'wrap', marginBottom: 'var(--space-lg)' }}>
              <button 
                onClick={pedirProcesarTodas} 
                disabled={procesandoGlobal}
                className="btn btn-primary" 
                style={{ padding: '0.5rem 1rem', width: 'auto', background: 'linear-gradient(135deg, #2e86c1, #1b4f72)' }}
              >
                {procesandoGlobal ? (
                  <><span className="spinner" style={{ width: '14px', height: '14px', borderWidth: '2px' }}/> Calificando {progreso.actual}/{progreso.total}</>
                ) : (
                  <><Brain size={16} /> Auto-calificar todas</>
                )}
              </button>

              {hayAlgunaSugerencia && (
                <button 
                  onClick={handleAceptarTodasIA} 
                  disabled={aceptandoTodas}
                  className="btn btn-primary" 
                  style={{ padding: '0.5rem 1rem', width: 'auto', background: 'linear-gradient(135deg, #27ae60, #1e8449)' }}
                >
                  {aceptandoTodas ? (
                    <><span className="spinner" style={{ width: '14px', height: '14px', borderWidth: '2px' }}/> Guardando...</>
                  ) : (
                    <><Check size={16} /> Aceptar todas las sugerencias ({respuestasConSugerencia.length})</>
                  )}
                </button>
              )}
            </div>
          )}

        {error && <div className="alert alert-error"><AlertCircle size={16} /><span>{error}</span></div>}

        {respuestas.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 'var(--space-3xl) var(--space-xl)' }}>
            <Check size={64} color="var(--color-success)" style={{ margin: '0 auto var(--space-md)' }} />
            <h3 style={{ marginBottom: 'var(--space-md)' }}>¡Todo calificado!</h3>
            <p style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-xl)' }}>
              No quedan respuestas pendientes de revisión para esta sesión.
            </p>
            <button onClick={() => navigate(`/admin/sesion/${id}/resultados`)} className="btn btn-primary" style={{ maxWidth: '250px' }}>
              Ver Resultados Finales
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-warning)' }}>
              <AlertCircle size={18} />
              <span style={{ fontWeight: 600 }}>{respuestas.length} respuestas pendientes de calificación</span>
            </div>

            {respuestas.map((resp, index) => {
              const evalIa = evaluacionesIa[resp.id]
              const modoEdicion = edicionManual[resp.id] !== undefined
              
              return (
                <div key={resp.id} className="card" style={{ padding: '0', overflow: 'hidden' }}>
                  
                  {/* Header de la tarjeta */}
                  <div style={{ background: 'var(--color-bg-base)', padding: '12px 16px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontWeight: 600, color: 'var(--color-accent)' }}>
                      {resp.participante_nombre}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', background: 'var(--color-bg-raised)', padding: '2px 8px', borderRadius: '12px' }}>
                      Puntaje Máx: {resp.pregunta_puntaje_max}
                    </div>
                  </div>

                  <div style={{ padding: 'var(--space-md)' }}>
                    {/* Pregunta */}
                    <div style={{ marginBottom: 'var(--space-md)' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pregunta</span>
                      <p style={{ fontSize: '1.05rem', marginTop: '4px' }}>{resp.pregunta_texto}</p>
                    </div>

                    {/* Respuesta de Referencia (Colapsable) */}
                    <div style={{ marginBottom: 'var(--space-md)', background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>
                      <button 
                        onClick={() => toggleReferencia(resp.id)}
                        style={{ width: '100%', padding: '8px 12px', background: 'none', border: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', color: 'var(--color-text-secondary)', fontSize: '0.85rem' }}
                      >
                        <span>Mostrar respuesta de referencia (Oculta por defecto)</span>
                        {referenciasVisibles[resp.id] ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </button>
                      {referenciasVisibles[resp.id] && (
                        <div style={{ padding: '12px', borderTop: '1px solid var(--color-border)', fontSize: '0.9rem', color: 'var(--color-success)', fontStyle: 'italic' }}>
                          {resp.pregunta_referencia}
                        </div>
                      )}
                    </div>

                    {/* Respuesta del Joven */}
                    <div style={{ marginBottom: 'var(--space-lg)' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--color-accent)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Respuesta del joven</span>
                      <div style={{ background: 'var(--color-bg-base)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', marginTop: '4px', fontSize: '1rem', fontStyle: 'italic', borderLeft: '3px solid var(--color-accent)' }}>
                        "{resp.respuesta_dada}"
                      </div>
                    </div>

                    {/* Área de Evaluación */}
                    <div style={{ background: 'var(--color-bg-raised)', padding: 'var(--space-md)', borderRadius: 'var(--radius-md)', border: '1px dashed var(--color-border)' }}>
                      
                      {!evalIa && !modoEdicion && (
                        <div style={{ textAlign: 'center' }}>
                          <button onClick={() => solicitarEvaluacionIndividual(resp)} className="btn btn-secondary" style={{ width: 'auto', margin: '0 auto' }}>
                            <Bot size={16} /> Solicitar sugerencia automática
                          </button>
                        </div>
                      )}

                      {evalIa?.cargando && (
                        <div style={{ textAlign: 'center', color: 'var(--color-text-muted)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                          <div className="spinner" />
                          <span style={{ fontSize: '0.85rem' }}>Analizando respuesta...</span>
                        </div>
                      )}

                      {evalIa && !evalIa.cargando && !modoEdicion && (
                        <div>
                          <div style={{ display: 'flex', gap: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
                            <div style={{ background: 'var(--color-bg-base)', padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', textAlign: 'center', minWidth: '80px' }}>
                              <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Sugerencia</div>
                              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: evalIa.puntaje > 0 ? 'var(--color-success)' : 'var(--color-error)' }}>
                                {evalIa.puntaje} <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', fontWeight: 400 }}>pts</span>
                              </div>
                            </div>
                            <div style={{ flex: 1, fontSize: '0.9rem', color: 'var(--color-text-secondary)', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                              <span style={{ color: 'var(--color-text-primary)', fontWeight: 600, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}><Brain size={14} color="#2e86c1"/> Justificación del sistema:</span>
                              {evalIa.justificacion}
                            </div>
                          </div>

                          <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                            <button onClick={() => handleAceptarIA(resp.id)} className="btn btn-primary" style={{ flex: 1, padding: '0.6rem' }}>
                              <Check size={18} /> Aceptar Sugerencia
                            </button>
                            <button onClick={() => setEdicionManual(prev => ({...prev, [resp.id]: evalIa.puntaje}))} className="btn btn-secondary" style={{ flex: 1, padding: '0.6rem', color: 'var(--color-warning)', borderColor: 'rgba(212,160,23,0.3)' }}>
                              <X size={18} /> Corregir Manualmente
                            </button>
                          </div>
                        </div>
                      )}

                      {modoEdicion && (
                        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--space-md)' }}>
                          <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
                            <label className="form-label">Ingresa el puntaje final (0 - {resp.pregunta_puntaje_max})</label>
                            <input 
                              type="number" 
                              className="form-input" 
                              min="0" 
                              max={resp.pregunta_puntaje_max}
                              value={edicionManual[resp.id] || ''}
                              onChange={e => setEdicionManual(prev => ({...prev, [resp.id]: e.target.value}))}
                              autoFocus
                            />
                          </div>
                          <button onClick={() => handleGuardarManual(resp.id)} className="btn btn-primary" style={{ width: 'auto' }}>
                            <Save size={16} /> Guardar
                          </button>
                          {evalIa && (
                            <button onClick={() => setEdicionManual(prev => { const n={...prev}; delete n[resp.id]; return n; })} className="btn btn-secondary" style={{ width: 'auto' }}>
                              Cancelar
                            </button>
                          )}
                        </div>
                      )}

                    </div>

                  </div>
                </div>
              )
            })}
          </div>
        )}

      </div>
      </div>
      
      <Modal 
        isOpen={modal.isOpen} 
        onClose={() => setModal(prev => ({ ...prev, isOpen: false }))} 
        onConfirm={modal.onConfirm}
        titulo={modal.titulo} 
        mensaje={modal.mensaje} 
        tipo={modal.tipo}
        isConfirm={modal.isConfirm}
      />
    </div>
  )
}
