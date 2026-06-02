import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { Plus, Edit2, Trash2, Search, Building2, Check, X, Users, MapPin } from 'lucide-react'
import Modal from '../../components/Modal'
import NavAdmin from '../../components/NavAdmin'

export default function GestionSociedades() {
  const navigate = useNavigate()
  
  const [sociedades, setSociedades] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [busqueda, setBusqueda] = useState('')
  
  // Modal de error / confirmación
  const [modal, setModal] = useState({ isOpen: false, titulo: '', mensaje: '', tipo: 'info', onConfirm: null, isConfirm: false })
  
  // Modal formulario
  const [modalForm, setModalForm] = useState(false)
  const [sociedadActual, setSociedadActual] = useState(null)
  const [form, setForm] = useState({ nombre: '', iglesia: '', total_censo: '' })
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    cargarSociedades()
  }, [])

  const cargarSociedades = async () => {
    try {
      setCargando(true)
      const { data, error } = await supabase
        .from('sociedades')
        .select('*')
        .order('nombre')

      if (error) throw error
      setSociedades(data)
    } catch (err) {
      setError('Error al cargar las sociedades')
    } finally {
      setCargando(false)
    }
  }

  const handleToggleActiva = async (id, estadoActual) => {
    try {
      // Intentamos actualizar la columna activa (si el usuario ya la agregó en Supabase)
      const { error } = await supabase
        .from('sociedades')
        .update({ activa: !estadoActual })
        .eq('id', id)

      if (error) throw error
      setSociedades(sociedades.map(s => s.id === id ? { ...s, activa: !estadoActual } : s))
    } catch (err) {
      if (err.message.includes("column \"activa\" of relation \"sociedades\" does not exist")) {
         setModal({ isOpen: true, titulo: 'Columna Faltante', mensaje: 'Debes agregar una columna booleana llamada "activa" con valor por defecto "true" en la tabla "sociedades" desde tu panel de Supabase para poder ocultar sociedades.', tipo: 'warning', isConfirm: false })
      } else {
         setModal({ isOpen: true, titulo: 'Error', mensaje: 'Error al actualizar el estado: ' + err.message, tipo: 'error', isConfirm: false })
      }
    }
  }

  const pedirEliminar = (id, nombre) => {
    setModal({
      isOpen: true,
      titulo: 'Eliminar Sociedad',
      mensaje: `¿Estás seguro de eliminar la sociedad "${nombre}"? Esta acción no se puede deshacer.`,
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
        .from('sociedades')
        .delete()
        .eq('id', id)

      if (error) throw error
      setSociedades(sociedades.filter(s => s.id !== id))
    } catch (err) {
      const msg = err?.code === '23503' || err?.message?.includes('foreign key') || err?.message?.includes('Conflict') 
        ? 'No puedes eliminar esta sociedad porque ya ha participado en exámenes y tiene un historial guardado. Te recomendamos simplemente "Ocultarla" haciendo clic en el check para que no aparezca al crear nuevos exámenes.'
        : 'Error al eliminar la sociedad: ' + err.message;
        
      setModal({ isOpen: true, titulo: 'No se puede eliminar', mensaje: msg, tipo: 'warning', isConfirm: false })
    }
  }

  const abrirNuevo = () => {
    setSociedadActual(null)
    setForm({ nombre: '', iglesia: '', total_censo: '' })
    setModalForm(true)
  }

  const abrirEditar = (soc) => {
    setSociedadActual(soc)
    setForm({ nombre: soc.nombre, iglesia: soc.iglesia, total_censo: soc.total_censo || '' })
    setModalForm(true)
  }

  const handleGuardar = async (e) => {
    e.preventDefault()
    setGuardando(true)
    
    try {
      const payload = {
        nombre: form.nombre,
        iglesia: form.iglesia,
        total_censo: parseInt(form.total_censo) || 0
      }

      if (sociedadActual) {
        // Actualizar
        const { data, error } = await supabase
          .from('sociedades')
          .update(payload)
          .eq('id', sociedadActual.id)
          .select()
          .single()

        if (error) throw error
        setSociedades(sociedades.map(s => s.id === sociedadActual.id ? data : s))
      } else {
        // Crear
        // Por defecto nueva sociedad es activa=true
        payload.activa = true
        
        try {
           const { data, error } = await supabase
            .from('sociedades')
            .insert([payload])
            .select()
            .single()

           if (error) throw error
           setSociedades([...sociedades, data].sort((a,b) => a.nombre.localeCompare(b.nombre)))
        } catch (insertErr) {
           // Si falla porque no existe la columna activa, intentar insertar sin activa
           if (insertErr.message.includes("column \"activa\" of relation \"sociedades\" does not exist")) {
               delete payload.activa
               const { data, error } = await supabase
                .from('sociedades')
                .insert([payload])
                .select()
                .single()
               if (error) throw error
               setSociedades([...sociedades, data].sort((a,b) => a.nombre.localeCompare(b.nombre)))
           } else {
               throw insertErr
           }
        }
      }
      
      setModalForm(false)
    } catch (err) {
      setModal({ isOpen: true, titulo: 'Error al guardar', mensaje: err.message, tipo: 'error', isConfirm: false })
    } finally {
      setGuardando(false)
    }
  }

  const filtradas = sociedades.filter(s => 
    s.nombre.toLowerCase().includes(busqueda.toLowerCase()) || 
    s.iglesia.toLowerCase().includes(busqueda.toLowerCase())
  )

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <NavAdmin />
      <div className="page-wrapper" style={{ padding: 'var(--space-xl)', flex: 1, alignItems: 'flex-start' }}>
        <div className="page-content animate-in" style={{ maxWidth: '1000px', width: '100%', margin: '0 auto' }}>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2xl)', flexWrap: 'wrap', gap: 'var(--space-md)' }}>
            <div>
              <h1 className="brand-title" style={{ fontSize: '2rem', marginBottom: 'var(--space-xs)', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <Building2 color="var(--color-accent)" size={32} />
                Gestión de Sociedades
              </h1>
              <p style={{ color: 'var(--color-text-muted)' }}>Agrega, edita u oculta las sociedades participantes</p>
            </div>
            <button onClick={abrirNuevo} className="btn btn-primary" style={{ width: 'auto' }}>
              <Plus size={18} />
              <span className="hide-mobile">Nueva Sociedad</span>
            </button>
          </div>

          {error && <div className="alert alert-error">{error}</div>}

          <div className="card" style={{ marginBottom: 'var(--space-lg)', padding: 'var(--space-md)' }}>
            <div className="form-group" style={{ margin: 0, position: 'relative' }}>
              <Search size={16} style={{ position: 'absolute', top: '15px', left: '12px', color: 'var(--color-text-muted)' }} />
              <input
                type="text"
                className="form-input"
                placeholder="Buscar por nombre o iglesia..."
                value={busqueda}
                onChange={e => setBusqueda(e.target.value)}
                style={{ paddingLeft: '35px' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 'var(--space-md)' }}>
            {cargando ? (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 'var(--space-2xl)' }}><div className="spinner" style={{ margin: '0 auto' }}/></div>
            ) : filtradas.length === 0 ? (
              <div className="card" style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 'var(--space-2xl)' }}>
                <Building2 size={48} color="var(--color-text-muted)" style={{ margin: '0 auto var(--space-md)' }} />
                <h3>No se encontraron sociedades</h3>
                <p style={{ color: 'var(--color-text-muted)' }}>Intenta buscar con otro término o crea una nueva.</p>
              </div>
            ) : (
              filtradas.map(s => {
                const isActiva = s.activa !== false // si es undefined asume true
                
                return (
                  <div key={s.id} className="card" style={{ padding: 'var(--space-lg)', display: 'flex', flexDirection: 'column', opacity: isActiva ? 1 : 0.6, transition: 'opacity 0.2s' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-md)' }}>
                      <h3 style={{ fontSize: '1.2rem', margin: 0, color: 'var(--color-text-primary)' }}>{s.nombre}</h3>
                      
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button 
                          onClick={() => handleToggleActiva(s.id, isActiva)}
                          title={isActiva ? "Ocultar" : "Mostrar"}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: isActiva ? 'var(--color-success)' : 'var(--color-text-muted)' }}
                        >
                          {isActiva ? <Check size={20} /> : <X size={20} />}
                        </button>
                        <button 
                          onClick={() => abrirEditar(s)}
                          className="btn btn-secondary"
                          style={{ padding: '6px', minWidth: 'auto', border: 'none', background: 'transparent' }}
                        >
                          <Edit2 size={16} />
                        </button>
                        <button 
                          onClick={() => pedirEliminar(s.id, s.nombre)}
                          className="btn btn-secondary"
                          style={{ padding: '6px', minWidth: 'auto', border: 'none', color: 'var(--color-error)', background: 'transparent' }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', color: 'var(--color-text-secondary)', fontSize: '0.9rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <MapPin size={16} color="var(--color-text-muted)" />
                        {s.iglesia}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Users size={16} color="var(--color-text-muted)" />
                        Censo: <strong style={{ color: 'var(--color-text-primary)' }}>{s.total_censo || 0}</strong> jóvenes
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>

      {/* Formulario Modal */}
      {modalForm && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-md)' }}>
          <form onSubmit={handleGuardar} className="card animate-in" style={{ maxWidth: '400px', width: '100%', padding: 'var(--space-2xl)' }}>
            <h3 style={{ fontSize: '1.3rem', marginBottom: 'var(--space-lg)' }}>
              {sociedadActual ? 'Editar Sociedad' : 'Nueva Sociedad'}
            </h3>
            
            <div className="form-group">
              <label className="form-label">Nombre de la Sociedad</label>
              <input type="text" className="form-input" required value={form.nombre} onChange={e => setForm({...form, nombre: e.target.value})} placeholder="Ej: Hijos del Trueno" />
            </div>
            
            <div className="form-group">
              <label className="form-label">Iglesia de Origen</label>
              <input type="text" className="form-input" required value={form.iglesia} onChange={e => setForm({...form, iglesia: e.target.value})} placeholder="Ej: Central" />
            </div>
            
            <div className="form-group">
              <label className="form-label">Total del Censo</label>
              <input type="number" className="form-input" required min="1" value={form.total_censo} onChange={e => setForm({...form, total_censo: e.target.value})} placeholder="Ej: 15" />
            </div>
            
            <div style={{ display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-xl)' }}>
              <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setModalForm(false)}>Cancelar</button>
              <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={guardando}>
                {guardando ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </form>
        </div>
      )}

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
