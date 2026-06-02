import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, calcularPuntajeSociedad } from '../../lib/supabase'
import { generarReportePDF } from '../../lib/pdf'
import NavAdmin from '../../components/NavAdmin'
import EstadoBadge from '../../components/EstadoBadge'
import { Trophy, Download, Award, Calendar, AlertCircle } from 'lucide-react'

export default function Ranking() {
  const navigate = useNavigate()
  const [ranking, setRanking] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    cargarRanking()
  }, [])

  const cargarRanking = async () => {
    try {
      setCargando(true)
      // Solo tomaremos las sesiones finalizadas
      const { data: sesiones, error: errSesiones } = await supabase
        .from('sesiones')
        .select('id, estado')
        .eq('estado', 'finalizado')

      if (errSesiones) throw errSesiones

      const resultadosPromises = sesiones.map(s => calcularPuntajeSociedad(s.id))
      const resultados = await Promise.all(resultadosPromises)
      
      const resultadosValidos = resultados.filter(r => r !== null)
      
      // Ordenar por porcentaje de mayor a menor
      resultadosValidos.sort((a, b) => b.porcentaje - a.porcentaje)
      
      setRanking(resultadosValidos)
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

  const exportarRanking = () => {
    if (ranking.length === 0) return

    const columnas = ['Posición', 'Sociedad', 'Iglesia', 'Participación', 'Puntaje Obtenido', 'Efectividad']
    const filas = ranking.map((item, index) => {
      const isPendiente = item.pendientesIA > 0
      const posStr = isPendiente ? '-' : `${index + 1}°`
      const efectividadStr = isPendiente ? 'Pendiente' : `${item.porcentaje}%`
      
      return [
        posStr,
        item.sociedad,
        item.iglesia,
        `${item.rindieron} de ${item.totalCenso}`,
        `${item.puntajeObtenido} / ${item.puntajeMaximo}`,
        efectividadStr
      ]
    })

    generarReportePDF({
      titulo: 'Ranking General del Torneo',
      subtitulo: `Total de sociedades evaluadas: ${ranking.length}`,
      columnas,
      filas,
      nombreArchivo: 'Ranking_Torneo_UJELADEA.pdf'
    })
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <NavAdmin />
      
      <div className="page-wrapper" style={{ padding: 'var(--space-xl)', flex: 1, alignItems: 'flex-start' }}>
        <div className="page-content animate-in" style={{ maxWidth: '1000px', width: '100%', margin: '0 auto' }}>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2xl)', flexWrap: 'wrap', gap: 'var(--space-md)' }}>
            <div>
              <h1 className="brand-title" style={{ fontSize: '2rem', marginBottom: 'var(--space-xs)', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <Trophy color="var(--color-accent)" size={32} />
                Ranking General
              </h1>
              <p style={{ color: 'var(--color-text-muted)' }}>Clasificación de todas las sociedades evaluadas</p>
            </div>
            <button onClick={exportarRanking} className="btn btn-secondary hide-mobile" style={{ width: 'auto' }}>
              <Download size={18} />
              Imprimir / Exportar PDF
            </button>
          </div>

          {error && (
            <div className="alert alert-error">
              <span>{error}</span>
            </div>
          )}

          {cargando ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="skeleton" style={{ height: '80px', width: '100%' }}></div>
              <div className="skeleton" style={{ height: '80px', width: '100%' }}></div>
              <div className="skeleton" style={{ height: '80px', width: '100%' }}></div>
            </div>
          ) : ranking.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 'var(--space-3xl)' }}>
              <Trophy size={64} color="var(--color-text-muted)" style={{ margin: '0 auto var(--space-lg)' }} />
              <h3>Aún no hay sociedades evaluadas</h3>
              <p style={{ color: 'var(--color-text-muted)' }}>El ranking aparecerá cuando al menos una sociedad finalice su sesión.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {ranking.map((item, index) => {
                const isPendiente = item.pendientesIA > 0;
                let positionBox = null;
                
                // Top 3 Styles
                if (!isPendiente) {
                  if (index === 0) positionBox = { bg: 'linear-gradient(135deg, #c9a84c, #e6c875)', color: '#000' };
                  else if (index === 1) positionBox = { bg: 'linear-gradient(135deg, #a8a4a0, #d1cecb)', color: '#000' };
                  else if (index === 2) positionBox = { bg: 'linear-gradient(135deg, #cd7f32, #e89c4e)', color: '#000' };
                }

                return (
                  <div key={item.sesionId} className="card fade-in" style={{ 
                    padding: '0', 
                    display: 'flex', 
                    alignItems: 'stretch', 
                    opacity: isPendiente ? 0.6 : 1,
                    border: index === 0 && !isPendiente ? '1px solid var(--color-accent)' : undefined
                  }}>
                    
                    {/* Position Indicator */}
                    <div style={{ 
                      width: '60px', 
                      background: positionBox ? positionBox.bg : 'var(--color-bg-base)', 
                      color: positionBox ? positionBox.color : 'var(--color-text-muted)',
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center', 
                      fontSize: '1.5rem', 
                      fontWeight: 800,
                      borderRight: '1px solid var(--color-border)'
                    }}>
                      {isPendiente ? '-' : `${index + 1}°`}
                    </div>

                    {/* Content */}
                    <div style={{ padding: 'var(--space-md) var(--space-lg)', flex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-md)' }}>
                      
                      <div style={{ flex: '1 1 250px' }}>
                        <h3 style={{ fontSize: '1.2rem', marginBottom: '4px', color: index === 0 && !isPendiente ? 'var(--color-accent-light)' : 'inherit' }}>
                          {item.sociedad}
                        </h3>
                        <div style={{ display: 'flex', gap: '16px', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                          <span>{item.iglesia}</span>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Calendar size={14}/> 
                            {new Date(item.fecha).toLocaleDateString()}
                          </span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xl)', flexWrap: 'wrap' }}>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Jóvenes</div>
                          <div style={{ fontWeight: 600 }}>{item.rindieron} / {item.totalCenso}</div>
                        </div>

                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Puntos</div>
                          <div style={{ fontWeight: 600 }}>{item.puntajeObtenido} / {item.puntajeMaximo}</div>
                        </div>

                        {isPendiente ? (
                          <div style={{ textAlign: 'right', minWidth: '120px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--color-warning)', justifyContent: 'flex-end', marginBottom: '4px' }}>
                              <AlertCircle size={14} />
                              <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Sin calificar</span>
                            </div>
                            <EstadoBadge estado="pendiente_ia" size="sm" />
                          </div>
                        ) : (
                          <div style={{ textAlign: 'right', minWidth: '120px' }}>
                            <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--color-text-primary)', lineHeight: 1 }}>
                              {item.porcentaje}%
                            </div>
                            <div style={{ marginTop: '4px' }}>
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

        </div>
      </div>
    </div>
  )
}
