import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { obtenerDatosCompletosRanking } from '../../lib/supabase'
import { generarReportePDF, generarInformeOficialDirectiva } from '../../lib/pdf'
import NavAdmin from '../../components/NavAdmin'
import EstadoBadge from '../../components/EstadoBadge'
import { 
  Trophy, Download, Award, Calendar, AlertCircle, ShieldAlert, 
  Star, ShieldCheck, Clock, Users, FileText, Loader2, Sparkles 
} from 'lucide-react'

export default function Ranking() {
  const navigate = useNavigate()
  const [datos, setDatos] = useState({
    rankingSociedades: [],
    rankingDisciplina: [],
    topJovenes: [],
    metricasGlobales: null
  })
  const [pestanaActiva, setPestanaActiva] = useState('sociedades') // 'sociedades' | 'jovenes' | 'disciplina'
  const [cargando, setCargando] = useState(true)
  const [generandoPDF, setGenerandoPDF] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    cargarRanking()
  }, [])

  const cargarRanking = async () => {
    try {
      setCargando(true)
      const res = await obtenerDatosCompletosRanking()
      setDatos(res)
    } catch (err) {
      setError('Error al cargar el ranking: ' + err.message)
    } finally {
      setCargando(false)
    }
  }

  const getBadgePorcentaje = (porcentaje) => {
    if (porcentaje >= 80) return <EstadoBadge estado="excelente" />
    if (porcentaje >= 60) return <EstadoBadge estado="bueno" />
    return <EstadoBadge estado="regular" />
  }

  // Exportar Informe Formal Oficial para la Directiva
  const exportarInformeDirectiva = async () => {
    if (!datos.rankingSociedades || datos.rankingSociedades.length === 0) return
    try {
      setGenerandoPDF(true)
      await generarInformeOficialDirectiva({
        rankingSociedades: datos.rankingSociedades,
        rankingDisciplina: datos.rankingDisciplina,
        topJovenes: datos.topJovenes,
        metricasGlobales: datos.metricasGlobales || {},
        nombreArchivo: `Informe_Oficial_Directiva_UJELADEA_${new Date().toISOString().split('T')[0]}.pdf`
      })
    } catch (err) {
      console.error('Error generando informe oficial:', err)
      alert('Hubo un inconveniente al generar el informe: ' + err.message)
    } finally {
      setGenerandoPDF(false)
    }
  }

  // Exportar lista simple tradicional en PDF
  const exportarListaSimple = () => {
    if (datos.rankingSociedades.length === 0) return

    const columnas = ['Posición', 'Sociedad', 'Iglesia', 'Participación', 'Puntaje Obtenido', 'Promedio', 'Alertas', 'Efectividad']
    const filas = datos.rankingSociedades.map((item, index) => {
      const isPendiente = item.pendientesIA > 0
      const posStr = isPendiente ? '-' : `${index + 1}°`
      const efectividadStr = isPendiente ? 'Pendiente' : `${item.porcentaje}%`
      const alertaStr = item.totalAlertas > 0 ? `${item.totalAlertas}${item.penalizacionPorcentaje > 0 ? ` (-${item.penalizacionPorcentaje}%)` : ''}` : '0'
      
      return [
        posStr,
        item.sociedad,
        item.iglesia,
        `${item.rindieron} de ${item.totalCenso || '-'}`,
        `${item.puntajeObtenido} / ${item.puntajeMaximo}`,
        `${item.promedioPorParticipante} pts`,
        alertaStr,
        efectividadStr
      ]
    })

    generarReportePDF({
      titulo: 'Ranking General de Sociedades',
      subtitulo: `Total de sociedades evaluadas: ${datos.rankingSociedades.length} | Olimpiadas Bíblicas UJELADEA`,
      columnas,
      filas,
      nombreArchivo: 'Ranking_General_Sociedades_UJELADEA.pdf'
    })
  }

  const { rankingSociedades, rankingDisciplina, topJovenes, metricasGlobales } = datos

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <NavAdmin />
      
      <div className="page-wrapper" style={{ padding: 'var(--space-xl)', flex: 1, alignItems: 'flex-start' }}>
        <div className="page-content animate-in" style={{ maxWidth: '1050px', width: '100%', margin: '0 auto' }}>
          
          {/* Encabezado Superior */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-xl)', flexWrap: 'wrap', gap: 'var(--space-md)' }}>
            <div>
              <h1 className="brand-title" style={{ fontSize: '2rem', marginBottom: 'var(--space-xs)', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <Trophy color="var(--color-accent)" size={32} />
                Ranking y Evaluación Oficial
              </h1>
              <p style={{ color: 'var(--color-text-muted)' }}>
                Olimpiadas Bíblicas UJELADEA 2026 — Clasificación y Cuadro de Honor
              </p>
            </div>

            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button 
                onClick={exportarInformeDirectiva} 
                disabled={generandoPDF || cargando || rankingSociedades.length === 0}
                className="btn btn-primary"
                style={{ width: 'auto', display: 'flex', alignItems: 'center', gap: '8px', boxShadow: '0 4px 14px rgba(143,25,55,0.3)' }}
                title="Genera el informe oficial para presentar a la directiva y pastores"
              >
                {generandoPDF ? <Loader2 className="spinner" size={18} /> : <FileText size={18} />}
                <span>{generandoPDF ? 'Generando Informe...' : 'Informe para Directiva (PDF)'}</span>
              </button>

              <button 
                onClick={exportarListaSimple} 
                disabled={cargando || rankingSociedades.length === 0}
                className="btn btn-secondary hide-mobile" 
                style={{ width: 'auto', display: 'flex', alignItems: 'center', gap: '6px' }}
                title="Exportar tabla simple en PDF"
              >
                <Download size={18} />
                Lista Simple
              </button>
            </div>
          </div>

          {error && (
            <div className="alert alert-error" style={{ marginBottom: 'var(--space-lg)' }}>
              <span>{error}</span>
            </div>
          )}

          {/* Panel de Indicadores Ejecutivos (KPIs) */}
          {!cargando && metricasGlobales && rankingSociedades.length > 0 && (
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', 
              gap: '12px', 
              marginBottom: 'var(--space-xl)' 
            }}>
              <div className="card" style={{ padding: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: '14px', background: 'var(--color-bg-card)' }}>
                <div style={{ width: '42px', height: '42px', borderRadius: '10px', background: 'rgba(143,25,55,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Trophy size={22} color="var(--color-accent)" />
                </div>
                <div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Sociedades</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--color-text-primary)' }}>{metricasGlobales.totalSociedades}</div>
                </div>
              </div>

              <div className="card" style={{ padding: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: '14px', background: 'var(--color-bg-card)' }}>
                <div style={{ width: '42px', height: '42px', borderRadius: '10px', background: 'rgba(39,174,96,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Users size={22} color="var(--color-success)" />
                </div>
                <div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Jóvenes Evaluados</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--color-text-primary)' }}>{metricasGlobales.totalJovenes}</div>
                </div>
              </div>

              <div className="card" style={{ padding: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: '14px', background: 'var(--color-bg-card)' }}>
                <div style={{ width: '42px', height: '42px', borderRadius: '10px', background: 'rgba(41,128,185,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Sparkles size={22} color="#2980b9" />
                </div>
                <div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Efectividad General</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--color-accent)' }}>
                    {metricasGlobales.promedioGeneralTorneo}%
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 400, marginLeft: '6px' }}>
                      ({metricasGlobales.promedioPuntosTorneo} pts)
                    </span>
                  </div>
                </div>
              </div>

              <div className="card" style={{ padding: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: '14px', background: 'var(--color-bg-card)' }}>
                <div style={{ width: '42px', height: '42px', borderRadius: '10px', background: 'rgba(212,160,23,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Star size={22} color="var(--color-accent)" />
                </div>
                <div style={{ overflow: 'hidden' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Mejor Nota</div>
                  <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-text-primary)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                    {metricasGlobales.mejorNota ? metricasGlobales.mejorNota.nombre : 'N/D'}
                  </div>
                  {metricasGlobales.mejorNota && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-accent)', fontWeight: 600 }}>
                      {metricasGlobales.mejorNota.puntaje} pts • {metricasGlobales.mejorNota.duracionTexto}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Navegación por Pestañas */}
          <div style={{ 
            display: 'flex', 
            gap: '8px', 
            borderBottom: '1px solid var(--color-border)', 
            marginBottom: 'var(--space-xl)',
            overflowX: 'auto',
            paddingBottom: '2px'
          }}>
            <button
              onClick={() => setPestanaActiva('sociedades')}
              className={`btn ${pestanaActiva === 'sociedades' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ 
                borderRadius: '8px 8px 0 0', 
                borderBottom: pestanaActiva === 'sociedades' ? '3px solid var(--color-accent)' : 'none',
                padding: '8px 16px',
                fontSize: '0.9rem',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                width: 'auto'
              }}
            >
              <Trophy size={16} />
              Sociedades (General)
            </button>

            <button
              onClick={() => setPestanaActiva('jovenes')}
              className={`btn ${pestanaActiva === 'jovenes' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ 
                borderRadius: '8px 8px 0 0', 
                borderBottom: pestanaActiva === 'jovenes' ? '3px solid var(--color-accent)' : 'none',
                padding: '8px 16px',
                fontSize: '0.9rem',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                width: 'auto'
              }}
            >
              <Star size={16} />
              Cuadro de Honor (Top Jóvenes)
            </button>

            <button
              onClick={() => setPestanaActiva('disciplina')}
              className={`btn ${pestanaActiva === 'disciplina' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ 
                borderRadius: '8px 8px 0 0', 
                borderBottom: pestanaActiva === 'disciplina' ? '3px solid var(--color-accent)' : 'none',
                padding: '8px 16px',
                fontSize: '0.9rem',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                width: 'auto'
              }}
            >
              <ShieldCheck size={16} />
              Juego Limpio y Disciplina
            </button>
          </div>

          {/* ESTADO DE CARGA */}
          {cargando ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="skeleton" style={{ height: '80px', width: '100%' }}></div>
              <div className="skeleton" style={{ height: '80px', width: '100%' }}></div>
              <div className="skeleton" style={{ height: '80px', width: '100%' }}></div>
            </div>
          ) : rankingSociedades.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 'var(--space-3xl)' }}>
              <Trophy size={64} color="var(--color-text-muted)" style={{ margin: '0 auto var(--space-lg)' }} />
              <h3>Aún no hay sociedades evaluadas</h3>
              <p style={{ color: 'var(--color-text-muted)' }}>El ranking aparecerá cuando al menos una sociedad finalice su sesión.</p>
            </div>
          ) : (
            <div>

              {/* ───────────────────────────────────────────────────────────── */}
              {/* PESTAÑA 1: SOCIEDADES (GENERAL)                               */}
              {/* ───────────────────────────────────────────────────────────── */}
              {pestanaActiva === 'sociedades' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '4px' }}>
                    Clasificación oficial por rendimiento neto y efectividad porcentual (equitativo para cualquier cantidad de participantes).
                  </div>

                  {rankingSociedades.map((item, index) => {
                    const isPendiente = item.pendientesIA > 0
                    let positionBox = null
                    
                    if (!isPendiente) {
                      if (index === 0) positionBox = { bg: 'linear-gradient(135deg, #c9a84c, #e6c875)', color: '#000', label: '1°' }
                      else if (index === 1) positionBox = { bg: 'linear-gradient(135deg, #a8a4a0, #d1cecb)', color: '#000', label: '2°' }
                      else if (index === 2) positionBox = { bg: 'linear-gradient(135deg, #cd7f32, #e89c4e)', color: '#000', label: '3°' }
                    }

                    return (
                      <div key={item.sesionId} className="card fade-in" style={{ 
                        padding: '0', 
                        display: 'flex', 
                        alignItems: 'stretch', 
                        opacity: isPendiente ? 0.6 : 1,
                        border: index === 0 && !isPendiente ? '1px solid var(--color-accent)' : undefined
                      }}>
                        
                        {/* Indicador de Posición */}
                        <div style={{ 
                          width: '64px', 
                          background: positionBox ? positionBox.bg : 'var(--color-bg-base)', 
                          color: positionBox ? positionBox.color : 'var(--color-text-muted)',
                          display: 'flex', 
                          flexDirection: 'column',
                          alignItems: 'center', 
                          justifyContent: 'center', 
                          fontSize: '1.5rem', 
                          fontWeight: 800,
                          borderRight: '1px solid var(--color-border)',
                          flexShrink: 0
                        }}>
                          {isPendiente ? '-' : `${index + 1}°`}
                          {index === 0 && !isPendiente && (
                            <span style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: '-2px' }}>Oro</span>
                          )}
                        </div>

                        {/* Contenido */}
                        <div style={{ padding: 'var(--space-md) var(--space-lg)', flex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-md)' }}>
                          
                          <div style={{ flex: '1 1 240px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <h3 style={{ fontSize: '1.2rem', marginBottom: '2px', color: index === 0 && !isPendiente ? 'var(--color-accent-light)' : 'inherit' }}>
                                {item.sociedad}
                              </h3>
                              {index === 0 && !isPendiente && <Award size={18} color="var(--color-accent)" />}
                            </div>

                            <div style={{ display: 'flex', gap: '16px', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                              <span>{item.iglesia}</span>
                              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <Calendar size={14}/> 
                                {new Date(item.fecha).toLocaleDateString()}
                              </span>
                            </div>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-lg)', flexWrap: 'wrap' }}>
                            <div style={{ textAlign: 'center' }}>
                              <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Jóvenes</div>
                              <div style={{ fontWeight: 600 }}>
                                {item.rindieron}
                                {item.totalCenso ? <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}> / {item.totalCenso}</span> : ''}
                              </div>
                            </div>

                            <div style={{ textAlign: 'center' }}>
                              <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Puntos Totales</div>
                              <div style={{ fontWeight: 600 }}>{item.puntajeObtenido} / {item.puntajeMaximo}</div>
                            </div>

                            <div style={{ textAlign: 'center' }}>
                              <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Promedio</div>
                              <div style={{ fontWeight: 700, color: 'var(--color-text-primary)' }}>{item.promedioPorParticipante} pts</div>
                            </div>

                            {isPendiente ? (
                              <div style={{ textAlign: 'right', minWidth: '130px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--color-warning)', justifyContent: 'flex-end', marginBottom: '4px' }}>
                                  <AlertCircle size={14} />
                                  <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Sin calificar</span>
                                </div>
                                <EstadoBadge estado="pendiente_ia" size="sm" />
                              </div>
                            ) : (
                              <div style={{ textAlign: 'right', minWidth: '130px' }}>
                                <div style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Efectividad</div>
                                <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--color-accent)', lineHeight: 1 }}>
                                  {item.porcentaje}%
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'flex-end', marginTop: '3px' }}>
                                  {item.penalizacionPorcentaje > 0 && (
                                    <span style={{ display: 'flex', alignItems: 'center', gap: '2px', fontSize: '0.7rem', color: 'var(--color-error)', fontWeight: 600 }}>
                                      <ShieldAlert size={10} />
                                      -{item.penalizacionPorcentaje}%
                                    </span>
                                  )}
                                  {getBadgePorcentaje(item.porcentaje)}
                                </div>
                              </div>
                            )}
                          </div>
                          
                          {isPendiente && (
                            <div style={{ width: '100%', marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--color-border)', textAlign: 'right' }}>
                              <button onClick={() => navigate(`/admin/sesion/${item.sesionId}/calificar`)} className="btn btn-secondary" style={{ padding: '4px 12px', fontSize: '0.8rem', width: 'auto' }}>
                                Revisar {item.pendientesIA} respuestas
                              </button>
                            </div>
                          )}

                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* ───────────────────────────────────────────────────────────── */}
              {/* PESTAÑA 2: CUADRO DE HONOR INDIVIDUAL (TOP JÓVENES)           */}
              {/* ───────────────────────────────────────────────────────────── */}
              {pestanaActiva === 'jovenes' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '4px' }}>
                    <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                      Reconocimiento a los 10 mejores exámenes individuales de todo el torneo bíblico (puntos, tiempo y pulcritud).
                    </div>
                  </div>

                  {topJovenes.length === 0 ? (
                    <div className="card" style={{ textAlign: 'center', padding: 'var(--space-2xl)' }}>
                      <Star size={48} color="var(--color-text-muted)" style={{ margin: '0 auto var(--space-md)' }} />
                      <h4>No hay participantes registrados aún</h4>
                    </div>
                  ) : (
                    topJovenes.map((joven, idx) => {
                      let podioStyle = null
                      if (idx === 0) podioStyle = { bg: 'linear-gradient(135deg, #c9a84c, #e6c875)', color: '#000', icon: '🥇' }
                      else if (idx === 1) podioStyle = { bg: 'linear-gradient(135deg, #a8a4a0, #d1cecb)', color: '#000', icon: '🥈' }
                      else if (idx === 2) podioStyle = { bg: 'linear-gradient(135deg, #cd7f32, #e89c4e)', color: '#000', icon: '🥉' }

                      return (
                        <div key={joven.id} className="card fade-in" style={{ 
                          padding: '0', 
                          display: 'flex', 
                          alignItems: 'stretch',
                          border: idx === 0 ? '1px solid var(--color-accent)' : undefined
                        }}>
                          
                          <div style={{ 
                            width: '56px', 
                            background: podioStyle ? podioStyle.bg : 'var(--color-bg-base)', 
                            color: podioStyle ? podioStyle.color : 'var(--color-text-muted)',
                            display: 'flex', 
                            alignItems: 'center', 
                            justifyContent: 'center', 
                            fontSize: '1.3rem', 
                            fontWeight: 800,
                            borderRight: '1px solid var(--color-border)',
                            flexShrink: 0
                          }}>
                            {podioStyle ? podioStyle.icon : `${idx + 1}°`}
                          </div>

                          <div style={{ padding: 'var(--space-md) var(--space-lg)', flex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-md)' }}>
                            <div style={{ flex: '1 1 240px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <h4 style={{ fontSize: '1.1rem', marginBottom: '2px', color: idx === 0 ? 'var(--color-accent-light)' : 'inherit' }}>
                                  {joven.nombre}
                                </h4>
                                {idx === 0 && <Star size={16} color="var(--color-accent)" fill="var(--color-accent)" />}
                              </div>
                              <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                                <strong style={{ color: 'var(--color-text-secondary)' }}>{joven.sociedad}</strong> • {joven.iglesia}
                              </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xl)', flexWrap: 'wrap' }}>
                              
                              <div style={{ textAlign: 'center' }}>
                                <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Tiempo</div>
                                <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'center' }}>
                                  <Clock size={14} color="var(--color-text-muted)" />
                                  <span>{joven.duracionTexto}</span>
                                </div>
                              </div>

                              <div style={{ textAlign: 'center' }}>
                                <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Alertas</div>
                                <div>
                                  {joven.alertas === 0 ? (
                                    <span style={{ fontSize: '0.78rem', color: 'var(--color-success)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '3px' }}>
                                      <ShieldCheck size={14} /> 0 (Limpio)
                                    </span>
                                  ) : (
                                    <span style={{ fontSize: '0.78rem', color: 'var(--color-warning)', fontWeight: 600 }}>
                                      {joven.alertas} avisos
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div style={{ textAlign: 'right', minWidth: '110px' }}>
                                <div style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Nota Final</div>
                                <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--color-accent)', lineHeight: 1 }}>
                                  {joven.puntaje}
                                  <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 400 }}> / {joven.puntajeMax}</span>
                                </div>
                                <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', fontWeight: 600, marginTop: '2px' }}>
                                  {joven.efectividad}% efectividad
                                </div>
                              </div>

                            </div>
                          </div>

                        </div>
                      )
                    })
                  )}
                </div>
              )}

              {/* ───────────────────────────────────────────────────────────── */}
              {/* PESTAÑA 3: JUEGO LIMPIO Y DISCIPLINA                          */}
              {/* ───────────────────────────────────────────────────────────── */}
              {pestanaActiva === 'disciplina' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '4px' }}>
                    Clasificación especial por disciplina, integridad digital y menor número de eventos de seguridad registrados durante la prueba.
                  </div>

                  {rankingDisciplina.map((item, index) => {
                    const esLimpio = item.totalAlertas === 0
                    const tienePenalizacion = item.penalizacionPorcentaje > 0

                    return (
                      <div key={item.sesionId} className="card fade-in" style={{ 
                        padding: 'var(--space-md) var(--space-lg)', 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center', 
                        flexWrap: 'wrap', 
                        gap: 'var(--space-md)',
                        borderLeft: esLimpio ? '4px solid var(--color-success)' : tienePenalizacion ? '4px solid var(--color-error)' : '4px solid var(--color-border)'
                      }}>
                        <div style={{ flex: '1 1 250px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontWeight: 800, color: 'var(--color-text-muted)', width: '28px' }}>#{index + 1}</span>
                            <h4 style={{ fontSize: '1.1rem', marginBottom: '2px' }}>{item.sociedad}</h4>
                            {esLimpio && (
                              <span style={{ background: 'rgba(39,174,96,0.15)', color: 'var(--color-success)', fontSize: '0.72rem', padding: '2px 8px', borderRadius: '12px', fontWeight: 700 }}>
                                Impecable
                              </span>
                            )}
                          </div>
                          <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginLeft: '36px' }}>
                            {item.iglesia} • {item.rindieron} participantes
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xl)', flexWrap: 'wrap' }}>
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Alertas de Seguridad</div>
                            <div style={{ fontWeight: 800, fontSize: '1.2rem', color: esLimpio ? 'var(--color-success)' : tienePenalizacion ? 'var(--color-error)' : 'var(--color-warning)' }}>
                              {item.totalAlertas}
                            </div>
                          </div>

                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Penalización</div>
                            <div style={{ fontWeight: 700, color: tienePenalizacion ? 'var(--color-error)' : 'var(--color-text-muted)' }}>
                              {tienePenalizacion ? `-${item.penalizacionPorcentaje}%` : '0%'}
                            </div>
                          </div>

                          <div style={{ textAlign: 'right', minWidth: '100px' }}>
                            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Efectividad Neta</div>
                            <div style={{ fontWeight: 800, fontSize: '1.2rem', color: 'var(--color-accent)' }}>
                              {item.porcentaje}%
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

            </div>
          )}

        </div>
      </div>
    </div>
  )
}
