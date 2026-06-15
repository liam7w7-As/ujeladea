import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase, calcularPuntajeSociedad } from '../../lib/supabase'
import { generarReportePDF } from '../../lib/pdf'
import { ArrowLeft, Download, Trophy, AlertCircle, CheckCircle2, Medal, Brain, ArrowRight, ShieldAlert, BarChart3 } from 'lucide-react'
import NavAdmin from '../../components/NavAdmin'
import EstadoBadge from '../../components/EstadoBadge'

export default function Resultados() {
  const { id } = useParams()
  const navigate = useNavigate()
  
  const [sesion, setSesion] = useState(null)
  const [participantes, setParticipantes] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [estadisticas, setEstadisticas] = useState(null)

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

      // 3. Cargar respuestas para ver si hay pendientes (simulación de lógica real)
      const { data: dataResp, error: errorResp } = await supabase
        .from('respuestas')
        .select('id, participante_id, puntaje_obtenido')
        .in('participante_id', dataPart.map(p => p.id))
        .is('puntaje_obtenido', null) // asumiendo que null es pendiente de calificar

      if (errorResp) throw errorResp

      // Mapear pendientes a los participantes
      const partConPendientes = dataPart.map(p => ({
        ...p,
        pendientes: dataResp.filter(r => r.participante_id === p.id).length
      }))

      setParticipantes(partConPendientes)

    } catch (err) {
      setError('Error al cargar los resultados: ' + err.message)
    } finally {
      setCargando(false)
    }
  }

  const exportarPDF = () => {
    if (!sesion || !estadisticas) return

    const columnas = ['Joven', 'Del Censo', 'Pendientes', 'Puntaje Total']
    const filas = participantes.map(p => [
      p.nombre,
      p.del_censo ? 'Sí' : 'No',
      p.pendientes > 0 ? `${p.pendientes} pend.` : '-',
      `${p.puntaje_total} pts`
    ])

    const isPendiente = estadisticas.pendientesIA > 0
    let subtitle = ''
    
    if (isPendiente) {
      subtitle = `Estado: PENDIENTE DE CALIFICAR (IA)\nCenso: ${estadisticas.rindieronCenso}/${estadisticas.totalCenso} | Invitados: ${estadisticas.invitados}`
    } else {
      subtitle = `Efectividad: ${estadisticas.porcentaje}%`
      if (estadisticas.penalizacionPorcentaje > 0) {
        subtitle += ` (Bruto: ${estadisticas.porcentajeBruto}% - Penalización: ${estadisticas.penalizacionPorcentaje}%)`
      }
      subtitle += `\nPuntaje Oficial: ${estadisticas.puntajeObtenido} / ${estadisticas.puntajeMaximo}`
      subtitle += `\nPromedio por Participante: ${estadisticas.promedioPorParticipante} pts`
      subtitle += `\nCenso: ${estadisticas.rindieronCenso}/${estadisticas.totalCenso} | Invitados: ${estadisticas.invitados}`
      if (estadisticas.totalAlertas > 0) {
        subtitle += `\nAlertas de Seguridad: ${estadisticas.totalAlertas}`
      }
    }

    generarReportePDF({
      titulo: `Resultados: ${sesion.sociedades.nombre}`,
      subtitulo: subtitle,
      columnas,
      filas,
      nombreArchivo: `Resultados_${sesion.sociedades.nombre.replace(/\s+/g, '_')}.pdf`
    })
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
            <div style={{ display: 'flex', gap: 'var(--space-md)' }}>
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
                <div>
                  <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '4px' }}>Censo Oficial</p>
                  <p style={{ fontSize: '1.2rem', fontWeight: 600 }}>{estadisticas.totalCenso} jóvenes</p>
                </div>
                <div>
                  <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '4px' }}>Rindieron Examen</p>
                  <p style={{ fontSize: '1.2rem', fontWeight: 600 }}>{estadisticas.rindieron} jóvenes</p>
                </div>
                <div>
                  <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '4px' }}>Puntaje Acumulado</p>
                  <p style={{ fontSize: '1.2rem', fontWeight: 600 }}>
                    {estadisticas.puntajeObtenido} / {estadisticas.puntajeMaximo}
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
        <h3 style={{ fontSize: '1.2rem', marginBottom: 'var(--space-md)' }}>Detalle por Participante</h3>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {participantes.map((p, index) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', padding: '16px', background: 'var(--color-bg-raised)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
              
              <div style={{ width: '40px', fontWeight: 600, color: index < 3 ? 'var(--color-accent)' : 'var(--color-text-muted)' }}>
                #{index + 1}
              </div>
              
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '1.05rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {p.nombre}
                  {!p.del_censo && (
                    <span style={{ fontSize: '0.65rem', padding: '2px 6px', background: 'var(--color-bg-hover)', color: 'var(--color-text-muted)', borderRadius: '10px', textTransform: 'uppercase' }}>
                      Invitado
                    </span>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-lg)' }}>
                {p.pendientes > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', color: 'var(--color-warning)' }}>
                    <AlertCircle size={14} />
                    {p.pendientes} pendientes de calificar
                  </div>
                )}
                
                <div style={{ textAlign: 'right', minWidth: '80px' }}>
                  <div style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                    {p.puntaje_total} <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>pts</span>
                  </div>
                </div>
              </div>

            </div>
          ))}
        </div>

      </div>
      </div>
    </div>
  )
}
