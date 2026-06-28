import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useExamen } from '../../context/ExamenContext'
import { supabase } from '../../lib/supabase'
import { Plus, ChevronRight, Calendar, Users, Trophy, Database, Brain, Trash2 } from 'lucide-react'
import NavAdmin from '../../components/NavAdmin'
import EstadoBadge from '../../components/EstadoBadge'
import Modal from '../../components/Modal'

export default function Dashboard() {
  const { usuario, logoutAdmin } = useExamen()
  const navigate = useNavigate()
  const [sesiones, setSesiones] = useState([])
  const [pendientes, setPendientes] = useState({}) // { sesion_id: boolean }
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [modal, setModal] = useState({ isOpen: false, titulo: '', mensaje: '', tipo: 'info', isConfirm: false, onConfirm: null })

  useEffect(() => {
    cargarSesiones()
  }, [])

  const cargarSesiones = async () => {
    try {
      setCargando(true)
      const { data, error } = await supabase
        .from('sesiones')
        .select(`
          *,
          sociedades ( nombre, total_censo ),
          participantes ( id )
        `)
        .order('created_at', { ascending: false })

      if (error) throw error
      setSesiones(data)

      // Cargar cuáles sesiones finalizadas tienen pendientes
      const finalizadasIds = data.filter(s => s.estado === 'finalizado').map(s => s.id)
      
      if (finalizadasIds.length > 0) {
        const { data: respPendientes, error: errResp } = await supabase
          .from('respuestas')
          .select('id, participantes!inner(sesion_id)')
          .eq('calificado_por', 'pendiente_ia')
          .in('participantes.sesion_id', finalizadasIds)

        if (!errResp && respPendientes) {
          const mapaPendientes = {}
          respPendientes.forEach(r => {
            const sid = r.participantes.sesion_id
            mapaPendientes[sid] = true
          })
          setPendientes(mapaPendientes)
        }
      }
    } catch (err) {
      setError(err.message || 'Error al cargar las sesiones')
    } finally {
      setCargando(false)
    }
  }

  const handleEliminarSesion = (id, nombre) => {
    setModal({
      isOpen: true,
      titulo: 'Eliminar Sesión',
      mensaje: `¿Estás SEGURO de eliminar la sesión de ${nombre}? Esto borrará también a los participantes y sus respuestas de forma permanente.`,
      tipo: 'error',
      isConfirm: true,
      onConfirm: () => ejecutarEliminarSesion(id)
    })
  }

  const ejecutarEliminarSesion = async (id) => {
    setModal(prev => ({ ...prev, isOpen: false }))
    try {
      setCargando(true)
      
      // Borrado en cascada manual
      await supabase.from('eventos_sesion').delete().eq('sesion_id', id)
      
      const { data: parts } = await supabase.from('participantes').select('id').eq('sesion_id', id)
      if (parts && parts.length > 0) {
        const pids = parts.map(p => p.id)
        await supabase.from('respuestas').delete().in('participante_id', pids)
      }
      
      await supabase.from('participantes').delete().eq('sesion_id', id)
      const { error } = await supabase.from('sesiones').delete().eq('id', id)
      
      if (error) throw error
      
      setSesiones(actuales => actuales.filter(s => s.id !== id))
    } catch (err) {
      setModal({ isOpen: true, titulo: 'Error', mensaje: 'Error al eliminar la sesión: ' + err.message, tipo: 'error', isConfirm: false })
    } finally {
      setCargando(false)
    }
  }

  const getBadgeEstado = (estado) => {
    switch (estado) {
      case 'esperando':
        return <span style={{ color: 'var(--color-warning)', border: '1px solid var(--color-warning)', padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600 }}>En Espera</span>
      case 'activo':
        return <span style={{ color: 'var(--color-info)', border: '1px solid var(--color-info)', padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600 }}>En Curso</span>
      case 'finalizado':
        return <span style={{ color: 'var(--color-success)', border: '1px solid var(--color-success)', padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600 }}>Finalizado</span>
      default:
        return null
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <NavAdmin />
      <div className="page-wrapper" style={{ padding: 'var(--space-md)', flex: 1, alignItems: 'flex-start' }}>
        <div className="page-content animate-in" style={{ maxWidth: '800px', width: '100%', margin: '0 auto' }}>

        {error && (
          <div className="alert alert-error">
            <span>{error}</span>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)', flexWrap: 'wrap', gap: 'var(--space-md)' }}>
          <h2 style={{ fontSize: '1.4rem', margin: 0 }}>Sesiones de Examen</h2>
          <div style={{ display: 'flex', gap: 'var(--space-md)' }}>
            <button onClick={() => navigate('/admin/preguntas')} className="btn btn-secondary" style={{ width: 'auto', background: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}>
              <Database size={18} />
              Banco de Preguntas
            </button>
            <button onClick={() => navigate('/admin/sesion/nueva')} className="btn btn-primary" style={{ width: 'auto' }}>
              <Plus size={18} />
              Nueva Sesión
            </button>
          </div>
        </div>

        {/* Lista de sesiones */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          {cargando ? (
            <div style={{ textAlign: 'center', padding: 'var(--space-2xl)' }}>
              <div className="spinner" style={{ margin: '0 auto', marginBottom: 'var(--space-md)' }} />
              <p style={{ color: 'var(--color-text-muted)' }}>Cargando sesiones...</p>
            </div>
          ) : sesiones.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 'var(--space-2xl)' }}>
              <Calendar size={48} color="var(--color-text-muted)" style={{ margin: '0 auto var(--space-md)' }} />
              <h3>No hay sesiones registradas</h3>
              <p style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-lg)' }}>Comienza creando una nueva sesión para el torneo.</p>
            </div>
          ) : (
            sesiones.map(sesion => (
              <div key={sesion.id} className="card" style={{ padding: 'var(--space-md)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-md)', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 min-content' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-xs)' }}>
                    <h3 style={{ fontSize: '1.1rem', margin: 0 }}>{sesion.sociedades?.nombre}</h3>
                    <EstadoBadge estado={sesion.estado} size="sm" />
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--space-lg)', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Calendar size={14} />
                      {new Date(sesion.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Users size={14} />
                      {sesion.participantes?.length ?? 0} participantes
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                  {(sesion.estado === 'esperando' || sesion.estado === 'activo') && (
                    <button 
                      onClick={() => navigate(`/admin/sesion/${sesion.id}/espera`)}
                      className="btn btn-secondary"
                      style={{ padding: '0.5rem 1rem' }}
                    >
                      Sala de Control
                      <ChevronRight size={16} />
                    </button>
                  )}
                  {sesion.estado === 'finalizado' && (
                    <>
                      {pendientes[sesion.id] && (
                        <button 
                          onClick={() => navigate(`/admin/sesion/${sesion.id}/calificar`)}
                          className="btn btn-secondary"
                          style={{ padding: '0.5rem 1rem', width: 'auto', color: '#fff', background: 'linear-gradient(135deg, #2e86c1, #1b4f72)', border: 'none' }}
                        >
                          <Brain size={16} />
                          Auto-calificar
                        </button>
                      )}
                      <button 
                        onClick={() => navigate(`/admin/sesion/${sesion.id}/resultados`)}
                        className="btn btn-primary"
                        style={{ padding: '0.5rem 1rem', width: 'auto' }}
                      >
                        <Trophy size={16} />
                        Resultados
                      </button>
                    </>
                  )}
                  
                  <button 
                    onClick={() => handleEliminarSesion(sesion.id, sesion.sociedades?.nombre)}
                    className="btn btn-secondary"
                    title="Eliminar sesión permanentemente"
                    style={{ padding: '0.5rem', minWidth: 'auto', color: 'var(--color-error)', borderColor: 'rgba(192, 57, 43, 0.3)', marginLeft: 'var(--space-sm)' }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
        </div>
      </div>

      <Modal 
        isOpen={modal.isOpen} 
        onClose={() => setModal(prev => ({ ...prev, isOpen: false }))} 
        titulo={modal.titulo} 
        mensaje={modal.mensaje} 
        tipo={modal.tipo}
        isConfirm={modal.isConfirm}
        onConfirm={modal.onConfirm}
        textoConfirmar={modal.isConfirm ? "Sí, eliminar" : "Aceptar"}
      />
    </div>
  )
}
