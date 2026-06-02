import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { generarReportePDF } from '../../lib/pdf'
import { ArrowLeft, Plus, Edit2, Trash2, Search, Filter, Database, Check, X, Download } from 'lucide-react'
import Modal from '../../components/Modal'
import NavAdmin from '../../components/NavAdmin'
import EstadoBadge from '../../components/EstadoBadge'

export default function BancoPreguntas() {
  const navigate = useNavigate()
  
  const [preguntas, setPreguntas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [modal, setModal] = useState({ isOpen: false, titulo: '', mensaje: '', tipo: 'info', onConfirm: null, isConfirm: false })
  
  // Filtros
  const [busqueda, setBusqueda] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('todas')
  const [filtroEstado, setFiltroEstado] = useState('todas')

  useEffect(() => {
    cargarPreguntas()
  }, [])

  const cargarPreguntas = async () => {
    try {
      setCargando(true)
      const { data, error } = await supabase
        .from('preguntas')
        .select('*')
        .order('id', { ascending: false })

      if (error) throw error
      setPreguntas(data)
    } catch (err) {
      setError('Error al cargar el banco de preguntas')
    } finally {
      setCargando(false)
    }
  }

  const handleToggleActiva = async (id, estadoActual) => {
    try {
      const { error } = await supabase
        .from('preguntas')
        .update({ activa: !estadoActual })
        .eq('id', id)

      if (error) throw error
      setPreguntas(preguntas.map(p => p.id === id ? { ...p, activa: !estadoActual } : p))
    } catch (err) {
      setModal({ isOpen: true, titulo: 'Error', mensaje: 'Error al actualizar el estado', tipo: 'error', isConfirm: false })
    }
  }

  const pedirEliminar = (id) => {
    setModal({
      isOpen: true,
      titulo: 'Eliminar Pregunta',
      mensaje: '¿Estás seguro de eliminar esta pregunta? Esta acción no se puede deshacer.',
      tipo: 'warning',
      isConfirm: true,
      onConfirm: () => {
        setModal(prev => ({ ...prev, isOpen: false }))
        handleEliminarReal(id)
      }
    })
  }

  const handleEliminarReal = async (id) => {
    try {
      const { error } = await supabase
        .from('preguntas')
        .delete()
        .eq('id', id)

      if (error) throw error
      setPreguntas(preguntas.filter(p => p.id !== id))
    } catch (err) {
      const msg = err?.code === '23503' || err?.message?.includes('foreign key') || err?.message?.includes('Conflict') 
        ? 'No puedes eliminar esta pregunta porque ya ha sido usada en exámenes y tiene respuestas guardadas. Te recomendamos simplemente "Desactivarla" para que no aparezca en futuros exámenes.'
        : 'Error al eliminar la pregunta: ' + err.message;
        
      setModal({ isOpen: true, titulo: 'No se puede eliminar', mensaje: msg, tipo: 'warning', isConfirm: false })
    }
  }

  // Filtrado
  const preguntasFiltradas = preguntas.filter(p => {
    const cumpleBusqueda = p.texto.toLowerCase().includes(busqueda.toLowerCase())
    const cumpleTipo = filtroTipo === 'todas' || p.tipo === filtroTipo
    const cumpleEstado = filtroEstado === 'todas' || 
                         (filtroEstado === 'activas' && p.activa) || 
                         (filtroEstado === 'inactivas' && !p.activa)
    
    return cumpleBusqueda && cumpleTipo && cumpleEstado
  })

  const cantActivas = preguntas.filter(p => p.activa).length

  const getTipoBadge = (tipo) => {
    switch (tipo) {
      case 'multiple': return <span style={{ color: '#2e86c1', background: 'rgba(46,134,193,0.1)', padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem' }}>Múltiple</span>
      case 'abierta': return <span style={{ color: '#d4a017', background: 'rgba(212,160,23,0.1)', padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem' }}>Abierta</span>
      case 'contexto': return <span style={{ color: '#8e44ad', background: 'rgba(142,68,173,0.1)', padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem' }}>Contexto</span>
      default: return null
    }
  }

  const exportarPDF = () => {
    if (preguntasFiltradas.length === 0) return

    const columnas = ['ID', 'Pregunta', 'Tipo', 'Estado', 'Puntaje', 'Respuesta Correcta']
    const filas = preguntasFiltradas.map(p => [
      p.id.toString(),
      p.texto,
      p.tipo,
      p.activa ? 'Activa' : 'Inactiva',
      p.puntaje.toString(),
      p.respuesta_correcta || 'N/A'
    ])

    let subtitulo = `Mostrando ${preguntasFiltradas.length} preguntas`
    if (filtroTipo !== 'todas') subtitulo += ` | Tipo: ${filtroTipo}`
    if (filtroEstado !== 'todas') subtitulo += ` | Estado: ${filtroEstado}`
    if (busqueda) subtitulo += ` | Búsqueda: "${busqueda}"`

    generarReportePDF({
      titulo: 'Banco de Preguntas Oficial',
      subtitulo: subtitulo,
      columnas,
      filas,
      nombreArchivo: 'Banco_Preguntas_UJELADEA.pdf'
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
                <Database color="var(--color-accent)" size={32} />
                Banco de Preguntas
              </h1>
              <p style={{ color: 'var(--color-text-muted)' }}>Gestiona las preguntas del torneo</p>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-md)' }}>
              <button onClick={exportarPDF} className="btn btn-secondary" style={{ width: 'auto' }}>
                <Download size={18} />
                <span className="hide-mobile">Exportar PDF</span>
              </button>
              <button onClick={() => navigate('/admin/preguntas/nueva')} className="btn btn-primary" style={{ width: 'auto' }}>
                <Plus size={18} />
                <span className="hide-mobile">Nueva Pregunta</span>
              </button>
            </div>
          </div> {error && <div className="alert alert-error">{error}</div>}

        <div className="card" style={{ marginBottom: 'var(--space-lg)', padding: 'var(--space-md)' }}>
          <div style={{ display: 'flex', gap: 'var(--space-md)', flexWrap: 'wrap' }}>
            <div className="form-group" style={{ flex: '1 1 250px', margin: 0, position: 'relative' }}>
              <Search size={16} style={{ position: 'absolute', top: '15px', left: '12px', color: 'var(--color-text-muted)' }} />
              <input
                type="text"
                className="form-input"
                placeholder="Buscar en el texto..."
                value={busqueda}
                onChange={e => setBusqueda(e.target.value)}
                style={{ paddingLeft: '35px' }}
              />
            </div>
            <div className="form-group" style={{ flex: '1 1 150px', margin: 0 }}>
              <select className="form-input" value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}>
                <option value="todas">Todos los tipos</option>
                <option value="multiple">Múltiple</option>
                <option value="abierta">Abierta</option>
                <option value="contexto">Contexto</option>
              </select>
            </div>
            <div className="form-group" style={{ flex: '1 1 150px', margin: 0 }}>
              <select className="form-input" value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}>
                <option value="todas">Todos los estados</option>
                <option value="activas">Activas</option>
                <option value="inactivas">Inactivas</option>
              </select>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          {cargando ? (
            <div style={{ textAlign: 'center', padding: 'var(--space-2xl)' }}><div className="spinner" style={{ margin: '0 auto' }}/></div>
          ) : preguntasFiltradas.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 'var(--space-2xl)' }}>
              <Database size={48} color="var(--color-text-muted)" style={{ margin: '0 auto var(--space-md)' }} />
              <h3>No se encontraron preguntas</h3>
              <p style={{ color: 'var(--color-text-muted)' }}>Intenta ajustar tus filtros o crea una nueva.</p>
            </div>
          ) : (
            preguntasFiltradas.map(p => (
              <div key={p.id} className="card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-md)', opacity: p.activa ? 1 : 0.6 }}>
                
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: '4px' }}>
                    {getTipoBadge(p.tipo)}
                    <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{p.puntaje} pts</span>
                  </div>
                  <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '1rem', color: 'var(--color-text-primary)' }}>
                    {p.texto}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                  <button 
                    onClick={() => handleToggleActiva(p.id, p.activa)}
                    title={p.activa ? "Desactivar" : "Activar"}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: p.activa ? 'var(--color-success)' : 'var(--color-text-muted)' }}
                  >
                    {p.activa ? <Check size={20} /> : <X size={20} />}
                  </button>
                  <div style={{ width: '1px', height: '24px', background: 'var(--color-border)', margin: '0 4px' }} />
                  <button 
                    onClick={() => navigate(`/admin/preguntas/${p.id}/editar`)}
                    className="btn btn-secondary"
                    style={{ padding: '6px', minWidth: 'auto', border: 'none' }}
                  >
                    <Edit2 size={16} />
                  </button>
                  <button 
                    onClick={() => pedirEliminar(p.id)}
                    className="btn btn-secondary"
                    style={{ padding: '6px', minWidth: 'auto', border: 'none', color: 'var(--color-error)' }}
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
        onConfirm={modal.onConfirm}
        titulo={modal.titulo} 
        mensaje={modal.mensaje} 
        tipo={modal.tipo}
        isConfirm={modal.isConfirm}
      />
    </div>
  )
}
