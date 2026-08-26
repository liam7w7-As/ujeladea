import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase, calcularPuntajeSociedad } from '../../lib/supabase'
import { calcularPuntajeAutomatico } from '../../lib/examen'
import { generarReporteResultados, generarReporteIndividual } from '../../lib/pdf'
import { ArrowLeft, Download, Trophy, AlertCircle, CheckCircle2, Medal, Brain, ArrowRight, ShieldAlert, BarChart3, FileText, Info, RefreshCw } from 'lucide-react'
import NavAdmin from '../../components/NavAdmin'
import EstadoBadge from '../../components/EstadoBadge'
import Modal from '../../components/Modal'

export default function Resultados() {
  const { id } = useParams()
  const navigate = useNavigate()
  
  const [sesion, setSesion] = useState(null)
  const [participantes, setParticipantes] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [estadisticas, setEstadisticas] = useState(null)
  const [generandoPdfId, setGenerandoPdfId] = useState(null)
  const [recalculando, setRecalculando] = useState(false)
  
  // Modal de notificación general
  const [modal, setModal] = useState({ isOpen: false, titulo: '', mensaje: '', tipo: 'info' })

  // Progreso interactivo de reevaluación
  const [progresoRecalculo, setProgresoRecalculo] = useState({
    activo: false,
    etapa: '',
    actual: 0,
    total: 0,
    corregidas: 0
  })

  useEffect(() => {
    cargarResultados()
  }, [id])

  const cargarResultados = async () => {
    try {
      setCargando(true)
      
      // Calcular puntajes usando la misma función del Ranking
      const stats = await calcularPuntajeSociedad(id)
      setEstadisticas(stats)

      // 1. Cargar sesión con sociedad
      const { data: dataSesion, error: errorSesion } = await supabase
        .from('sesiones')
        .select('*, sociedades(nombre, total_censo)')
        .eq('id', id)
        .single()
      
      if (errorSesion) throw errorSesion
      setSesion(dataSesion)

      // 2. Cargar participantes
      const { data: dataPart, error: errorPart } = await supabase
        .from('participantes')
        .select('*')
        .eq('sesion_id', id)
        .order('puntaje_total', { ascending: false })
      
      if (errorPart) throw errorPart

      const partIds = dataPart.map(p => p.id)

      // 3. Cargar TODAS las respuestas para calcular puntaje máximo por joven
      //    y detectar pendientes
      const { data: dataResp, error: errorResp } = await supabase
        .from('respuestas')
        .select('participante_id, puntaje_obtenido, calificado_por, preguntas(puntaje)')
        .in('participante_id', partIds)

      if (errorResp) throw errorResp

      // 4. Cargar alertas de seguridad por participante
      const { data: dataAlertas, error: errorAlertas } = await supabase
        .from('resumen_alertas')
        .select('participante_id, total_eventos')
        .eq('sesion_id', id)

      // Construir mapa de alertas por participante
      const alertasPorPart = {}
      if (!errorAlertas && dataAlertas) {
        dataAlertas.forEach(a => { alertasPorPart[a.participante_id] = a.total_eventos })
      }

      // 5. Calcular puntaje máximo y pendientes por participante
      const partConDetalle = dataPart.map(p => {
        const respsDeEstePart = dataResp.filter(r => r.participante_id === p.id)
        const puntajeMax = respsDeEstePart.reduce((sum, r) => sum + (r.preguntas?.puntaje || 0), 0)
        const pendientes = respsDeEstePart.filter(r => r.calificado_por === 'pendiente_ia' || r.puntaje_obtenido === null).length
        return {
          ...p,
          puntaje_max: puntajeMax,
          pendientes,
          alertas: alertasPorPart[p.id] || 0
        }
      })

      setParticipantes(partConDetalle)

    } catch (err) {
      setError('Error al cargar los resultados: ' + err.message)
    } finally {
      setCargando(false)
    }
  }

  const exportarPDF = () => {
    if (!sesion || !estadisticas) return

    generarReporteResultados({
      sesion: {
        sociedad: sesion.sociedades?.nombre,
        iglesia: sesion.sociedades?.iglesia || '',
        fecha: sesion.created_at,
      },
      estadisticas,
      participantes,
      nombreArchivo: `Resultados_${sesion.sociedades?.nombre?.replace(/\s+/g, '_')}.pdf`
    })
  }

  const handleRecalcularMultiple = async () => {
    try {
      setRecalculando(true)
      setProgresoRecalculo({
        activo: true,
        etapa: 'Consultando participantes de la sesión...',
        actual: 0,
        total: 0,
        corregidas: 0
      })
      
      // 1. Participantes de esta sesión
      const { data: parts, error: errParts } = await supabase
        .from('participantes')
        .select('id')
        .eq('sesion_id', id)
      
      if (errParts) throw errParts
      if (!parts || parts.length === 0) {
        setProgresoRecalculo({ activo: false, etapa: '', actual: 0, total: 0, corregidas: 0 })
        setModal({ isOpen: true, titulo: 'Sin participantes', mensaje: 'No hay participantes registrados en esta sesión.', tipo: 'warning' })
        return
      }

      const partIds = parts.map(p => p.id)

      setProgresoRecalculo(prev => ({
        ...prev,
        etapa: 'Cargando respuestas de opción múltiple...'
      }))

      // 2. Obtener todas las respuestas de múltiple opción para estos participantes
      const { data: resps, error: errResps } = await supabase
        .from('respuestas')
        .select(`
          id,
          respuesta_dada,
          puntaje_obtenido,
          es_correcta,
          participante_id,
          preguntas!inner (
            id,
            texto,
            respuesta_correcta,
            puntaje,
            tipo,
            opciones
          )
        `)
        .in('participante_id', partIds)
        .eq('preguntas.tipo', 'multiple')

      if (errResps) throw errResps

      const totalResps = (resps || []).length
      let corregidas = 0

      setProgresoRecalculo({
        activo: true,
        etapa: `Reevaluando ${totalResps} respuestas de selección múltiple...`,
        actual: 0,
        total: totalResps,
        corregidas: 0
      })

      // 3. Evaluar cada respuesta con la lógica mejorada
      for (let i = 0; i < totalResps; i++) {
        const r = resps[i]
        const evaluacion = calcularPuntajeAutomatico(r.preguntas, r.respuesta_dada)
        
        // Si el puntaje o estado cambió, actualizar en DB
        if (r.puntaje_obtenido !== evaluacion.puntaje_obtenido || r.es_correcta !== evaluacion.es_correcta) {
          const { error: errUpd } = await supabase
            .from('respuestas')
            .update({
              puntaje_obtenido: evaluacion.puntaje_obtenido,
              es_correcta: evaluacion.es_correcta,
              calificado_por: 'sistema'
            })
            .eq('id', r.id)

          if (!errUpd) corregidas++
        }

        // Actualizar barra de progreso
        setProgresoRecalculo(prev => ({
          ...prev,
          actual: i + 1,
          corregidas
        }))
      }

      // 4. Recalcular el puntaje_total de cada participante sumando todas sus respuestas
      setProgresoRecalculo({
        activo: true,
        etapa: `Actualizando puntajes de ${partIds.length} participantes...`,
        actual: 0,
        total: partIds.length,
        corregidas
      })

      for (let j = 0; j < partIds.length; j++) {
        const pId = partIds[j]
        const { data: todasResp, error: errSum } = await supabase
          .from('respuestas')
          .select('puntaje_obtenido')
          .eq('participante_id', pId)

        if (!errSum && todasResp) {
          const sumaTotal = todasResp.reduce((acc, curr) => acc + (curr.puntaje_obtenido || 0), 0)
          await supabase
            .from('participantes')
            .update({ puntaje_total: sumaTotal })
            .eq('id', pId)
        }

        setProgresoRecalculo(prev => ({
          ...prev,
          actual: j + 1
        }))
      }

      await cargarResultados()

      setProgresoRecalculo({ activo: false, etapa: '', actual: 0, total: 0, corregidas: 0 })
      setModal({
        isOpen: true,
        titulo: '¡Recálculo Exitoso!',
        mensaje: `Se reevaluaron exitosamente ${totalResps} respuestas de opción múltiple. Se corrigieron ${corregidas} notas y se actualizaron los puntajes totales de todos los jóvenes.`,
        tipo: 'success'
      })

    } catch (err) {
      setProgresoRecalculo({ activo: false, etapa: '', actual: 0, total: 0, corregidas: 0 })
      setModal({
        isOpen: true,
        titulo: 'Error al recalcular',
        mensaje: 'Ocurrió un error: ' + err.message,
        tipo: 'error'
      })
    } finally {
      setRecalculando(false)
    }
  }

  const handleExportarIndividual = async (p) => {
    if (!sesion) return
    try {
      setGenerandoPdfId(p.id)
      const { data: respuestas, error: errResp } = await supabase
        .from('respuestas')
        .select(`
          id,
          respuesta_dada,
          es_correcta,
          puntaje_obtenido,
          calificado_por,
          preguntas (
            texto,
            respuesta_correcta,
            puntaje,
            tipo
          )
        `)
        .eq('participante_id', p.id)
        .order('id', { ascending: true })

      if (errResp) throw errResp

      await generarReporteIndividual({
        sesion: {
          sociedad: sesion.sociedades?.nombre,
          iglesia: sesion.sociedades?.iglesia || '',
          fecha: sesion.created_at,
        },
        participante: p,
        respuestas: respuestas || [],
        nombreArchivo: `Examen_${p.nombre.replace(/\s+/g, '_')}_Resultados.pdf`
      })
    } catch (err) {
      setModal({
        isOpen: true,
        titulo: 'Error en PDF',
        mensaje: 'Error al generar el reporte individual: ' + err.message,
        tipo: 'error'
      })
    } finally {
      setGenerandoPdfId(null)
    }
  }

  if (cargando) return <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}><NavAdmin /><div className="page-wrapper"><div className="spinner" /></div></div>
  if (error) return <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}><NavAdmin /><div className="page-wrapper"><div className="alert alert-error">{error}</div></div></div>
  if (!sesion || !estadisticas) return null

  const isPendiente = estadisticas.pendientesIA > 0;
  
  let badgeGlobal = { label: 'Regular', color: 'var(--color-error)' }
  if (estadisticas.porcentaje >= 80) badgeGlobal = { label: 'Excelente', color: 'var(--color-success)' }
  else if (estadisticas.porcentaje >= 60) badgeGlobal = { label: 'Bueno', color: 'var(--color-warning)' }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <NavAdmin />
      <div className="page-wrapper" style={{ padding: 'var(--space-md)', flex: 1, alignItems: 'flex-start' }}>
        <div className="page-content animate-in" style={{ maxWidth: '900px', width: '100%', margin: '0 auto' }}>
          
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-xl)', flexWrap: 'wrap', gap: 'var(--space-md)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
              <div>
                <h1 className="brand-title" style={{ fontSize: '2rem', marginBottom: 0 }}>Resultados Oficiales</h1>
                <p style={{ color: 'var(--color-accent)', fontSize: '1rem' }}>{sesion.sociedades?.nombre}</p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-md)', flexWrap: 'wrap' }}>
              <button 
                onClick={handleRecalcularMultiple} 
                disabled={recalculando} 
                className="btn btn-secondary" 
                title="Reevalúa todas las respuestas de opción múltiple de esta sesión"
                style={{ width: 'auto' }}
              >
                <RefreshCw size={16} className={recalculando ? 'spin-animation' : ''} />
                {recalculando ? 'Recalculando...' : 'Reevaluar Múltiples'}
              </button>
              <button onClick={() => navigate('/admin/ranking')} className="btn btn-secondary hide-mobile" style={{ width: 'auto' }}>
                <Trophy size={16} /> Ver en Ranking
              </button>
              <button onClick={exportarPDF} className="btn btn-secondary" style={{ width: 'auto' }}>
                <Download size={18} />
                Exportar a PDF
              </button>
            </div>
          </div>

          {/* Tarjeta Resumen Sociedad */}
          <div className="card" style={{ marginBottom: 'var(--space-lg)', position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: '-20px', right: '-20px', opacity: 0.05, transform: 'rotate(15deg)' }}>
              <Trophy size={150} />
            </div>
            <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xl)', alignItems: 'center', justifyContent: 'space-between' }}>
              
              <div>
                <h3 style={{ fontSize: '1rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 'var(--space-xs)' }}>
                  Rendimiento de la Sociedad
                </h3>
                {isPendiente ? (
                  <div style={{ marginTop: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-warning)', marginBottom: '8px' }}>
                      <AlertCircle size={24} />
                      <span style={{ fontSize: '1.2rem', fontWeight: 600 }}>Puntaje no final</span>
                    </div>
                    <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', marginBottom: '16px' }}>
                      Faltan calificar respuestas abiertas.
                    </p>
                    <button onClick={() => navigate(`/admin/sesion/${sesion.id}/calificar`)} className="btn btn-primary" style={{ width: 'auto', background: 'linear-gradient(135deg, #2e86c1, #1b4f72)' }}>
                      <Brain size={16} /> Auto-calificar ({estadisticas.pendientesIA})
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--space-sm)' }}>
                    <span style={{ fontSize: '4rem', fontFamily: 'var(--font-heading)', fontWeight: 700, lineHeight: 1, color: 'var(--color-accent)' }}>
                      {estadisticas.porcentaje}%
                    </span>
                    <span style={{ padding: '4px 12px', background: `${badgeGlobal.color}22`, color: badgeGlobal.color, border: `1px solid ${badgeGlobal.color}55`, borderRadius: '16px', fontSize: '0.85rem', fontWeight: 600, marginBottom: '12px' }}>
                      {badgeGlobal.label}
                    </span>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 'var(--space-xl)', flexWrap: 'wrap' }}>
                {estadisticas.totalCenso && (
                  <div>
                    <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '4px' }}>Censo Oficial</p>
                    <p style={{ fontSize: '1.2rem', fontWeight: 600 }}>{estadisticas.totalCenso} jóvenes</p>
                  </div>
                )}
                <div>
                  <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '4px' }}>Participaron</p>
                  <p style={{ fontSize: '1.2rem', fontWeight: 600 }}>{estadisticas.rindieron} jóvenes</p>
                </div>
                <div>
                  <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '4px' }}>Puntaje Real</p>
                  <p style={{ fontSize: '1.2rem', fontWeight: 600 }}>
                    {estadisticas.puntajeObtenido} / {estadisticas.puntajeMaximo} pts
                  </p>
                </div>
                <div>
                  <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}><BarChart3 size={14} /> Promedio</p>
                  <p style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--color-accent)' }}>
                    {estadisticas.promedioPorParticipante} <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>pts/joven</span>
                  </p>
                </div>
              </div>

            </div>
          </div>

          {/* Tarjeta de Alertas y Penalización */}
          {estadisticas.totalAlertas > 0 && (
            <div className="card" style={{ marginBottom: 'var(--space-lg)', padding: 'var(--space-lg)', border: estadisticas.penalizacionPorcentaje > 0 ? '1px solid rgba(231, 76, 60, 0.3)' : '1px solid var(--color-border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-md)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
                  <div style={{ background: 'rgba(231, 76, 60, 0.1)', padding: '12px', borderRadius: '50%' }}>
                    <ShieldAlert size={28} color="var(--color-error)" />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '1.1rem', margin: 0, marginBottom: '4px' }}>Alertas de Seguridad</h3>
                    <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', margin: 0 }}>
                      Se registraron <strong style={{ color: 'var(--color-error)' }}>{estadisticas.totalAlertas}</strong> eventos sospechosos durante el examen
                    </p>
                  </div>
                </div>
                
                {estadisticas.penalizacionPorcentaje > 0 ? (
                  <div style={{ textAlign: 'center', background: 'rgba(231, 76, 60, 0.08)', padding: '12px 20px', borderRadius: 'var(--radius-md)', border: '1px solid rgba(231, 76, 60, 0.2)' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--color-error)', textTransform: 'uppercase', fontWeight: 600 }}>Penalización aplicada</div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--color-error)' }}>-{estadisticas.penalizacionPorcentaje}%</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{estadisticas.porcentajeBruto}% → {estadisticas.porcentaje}%</div>
                  </div>
                ) : (
                  <div style={{ background: 'rgba(45, 138, 78, 0.08)', padding: '8px 16px', borderRadius: 'var(--radius-md)', border: '1px solid rgba(45, 138, 78, 0.2)', fontSize: '0.85rem', color: 'var(--color-success)' }}>
                    Sin penalización (menos de 20 alertas)
                  </div>
                )}
              </div>

              <div style={{ marginTop: 'var(--space-md)', padding: 'var(--space-sm)', background: 'var(--color-bg-base)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                <strong>Escala de penalización:</strong> 0-19 alertas = sin rebaja • 20-29 alertas = -5% • 30-39 alertas = -10% • 40+ alertas = -15%
              </div>
            </div>
          )}

        {/* Lista de Participantes */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 'var(--space-md)', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
          <div>
            <h3 style={{ fontSize: '1.2rem', margin: 0, marginBottom: '4px' }}>Detalle por Participante</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Info size={14} color="var(--color-accent)" /> 
              El botón de reporte individual por joven funcionará mejor y con datos completos si el examen ya fue calificado en su totalidad.
            </p>
          </div>
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {participantes.map((p, index) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', padding: '16px', background: 'var(--color-bg-raised)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', gap: 'var(--space-md)', flexWrap: 'wrap' }}>
              
              <div style={{ width: '40px', fontWeight: 600, color: index < 3 ? 'var(--color-accent)' : 'var(--color-text-muted)', flexShrink: 0 }}>
                #{index + 1}
              </div>
              
              <div style={{ flex: 1, minWidth: '120px' }}>
                <div style={{ fontSize: '1.05rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  {p.nombre}
                  {!p.del_censo && (
                    <span style={{ fontSize: '0.65rem', padding: '2px 6px', background: 'var(--color-bg-hover)', color: 'var(--color-text-muted)', borderRadius: '10px', textTransform: 'uppercase' }}>
                      Invitado
                    </span>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', flexWrap: 'wrap' }}>

                {/* Alertas del joven */}
                {p.alertas > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.78rem', padding: '3px 8px', borderRadius: '10px', background: p.alertas >= 20 ? 'rgba(192,57,43,0.12)' : 'rgba(230,126,34,0.12)', color: p.alertas >= 20 ? 'var(--color-error)' : 'var(--color-warning)', border: `1px solid ${p.alertas >= 20 ? 'rgba(192,57,43,0.3)' : 'rgba(230,126,34,0.3)'}` }}>
                    <ShieldAlert size={13} />
                    {p.alertas} alertas
                  </div>
                )}

                {/* Pendientes */}
                {p.pendientes > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', color: 'var(--color-warning)' }}>
                    <AlertCircle size={14} />
                    {p.pendientes} pend.
                  </div>
                )}
                
                {/* Puntaje obtenido / máximo */}
                <div style={{ textAlign: 'right', minWidth: '110px' }}>
                  <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--color-accent)', lineHeight: 1 }}>
                    {p.puntaje_total ?? 0}
                    <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', fontWeight: 400 }}> / {p.puntaje_max ?? '?'}</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 400 }}> pts</span>
                  </div>
                  {p.puntaje_max > 0 && (
                    <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                      {Math.round((p.puntaje_total / p.puntaje_max) * 100)}% de efectividad
                    </div>
                  )}
                </div>

                {/* Botón Reporte Individual */}
                <button
                  onClick={() => handleExportarIndividual(p)}
                  disabled={generandoPdfId === p.id}
                  className="btn btn-secondary"
                  title="Descargar reporte individual con preguntas y respuestas"
                  style={{
                    padding: '6px 12px',
                    fontSize: '0.8rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    minWidth: 'auto',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg-base)'
                  }}
                >
                  {generandoPdfId === p.id ? (
                    <span className="spinner" style={{ width: '13px', height: '13px', borderWidth: '2px' }} />
                  ) : (
                    <FileText size={15} color="var(--color-accent)" />
                  )}
                  <span>Reporte</span>
                </button>

              </div>

            </div>
          ))}
        </div>

      </div>
      </div>

      {/* Modal de Progreso de Recálculo */}
      {progresoRecalculo.activo && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.7)',
          backdropFilter: 'blur(6px)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 'var(--space-md)'
        }}>
          <div className="card animate-in" style={{ maxWidth: '440px', width: '100%', padding: 'var(--space-2xl) var(--space-xl)', textAlign: 'center', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xl)' }}>
            <div style={{ display: 'inline-flex', padding: '16px', borderRadius: '50%', background: 'rgba(212, 160, 23, 0.1)', marginBottom: 'var(--space-md)' }}>
              <RefreshCw size={36} color="var(--color-accent)" className="spin-animation" />
            </div>
            
            <h3 style={{ fontSize: '1.3rem', marginBottom: 'var(--space-xs)' }}>
              Reevaluando Selección Múltiple
            </h3>
            
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', marginBottom: 'var(--space-lg)' }}>
              {progresoRecalculo.etapa}
            </p>

            {/* Barra de progreso */}
            {progresoRecalculo.total > 0 && (
              <div style={{ marginBottom: 'var(--space-md)' }}>
                <div style={{
                  height: '10px',
                  width: '100%',
                  background: 'var(--color-bg-base)',
                  borderRadius: '10px',
                  overflow: 'hidden',
                  border: '1px solid var(--color-border)',
                  position: 'relative'
                }}>
                  <div style={{
                    height: '100%',
                    width: `${Math.round((progresoRecalculo.actual / progresoRecalculo.total) * 100)}%`,
                    background: 'linear-gradient(90deg, var(--color-primary), var(--color-accent))',
                    borderRadius: '10px',
                    transition: 'width 0.2s ease'
                  }} />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: '6px' }}>
                  <span>{progresoRecalculo.actual} de {progresoRecalculo.total}</span>
                  <span style={{ fontWeight: 600, color: 'var(--color-accent)' }}>
                    {Math.round((progresoRecalculo.actual / progresoRecalculo.total) * 100)}%
                  </span>
                </div>
              </div>
            )}

            {progresoRecalculo.corregidas > 0 && (
              <div style={{ fontSize: '0.85rem', color: 'var(--color-success)', background: 'rgba(39, 174, 96, 0.1)', padding: '6px 12px', borderRadius: 'var(--radius-sm)', display: 'inline-block' }}>
                ✓ {progresoRecalculo.corregidas} respuesta(s) corregida(s)
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal de Alertas y Confirmaciones */}
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


