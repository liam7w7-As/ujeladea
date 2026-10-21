import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useEtapa } from '../../context/etapa-context'
import EtapaAviso from '../../components/EtapaAviso'
import { ArrowLeft, Search, Plus, Trash2 } from 'lucide-react'

export default function CrearSesion() {
  const navigate = useNavigate()
  const { etapa } = useEtapa()
  const [paso, setPaso] = useState(1)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')

  // Datos de sociedades
  const [sociedades, setSociedades] = useState([])
  const [busqueda, setBusqueda] = useState('')
  const [sociedadSeleccionada, setSociedadSeleccionada] = useState(null)
  
  // Datos nueva sociedad (si no existe)
  const [nuevaSociedad, setNuevaSociedad] = useState({ nombre: '', iglesia: '' })
  const [mostrandoFormNueva, setMostrandoFormNueva] = useState(false)

  // Datos de participantes
  const [participantes, setParticipantes] = useState([])
  const [nuevoParticipante, setNuevoParticipante] = useState({ nombre: '', del_censo: false })

  // Configuración de examen
  const configuracion = { tiempo_limite: etapa.tiempo_limite, cant_preguntas: etapa.cantidad_preguntas }

  useEffect(() => {
    let vigente = true
    supabase.from('sociedades').select('*').eq('activa', true).order('nombre').then(({ data, error }) => {
      if (!vigente) return
      if (error) setError('No se pudo cargar el catálogo de sociedades.')
      else setSociedades(data || [])
    })
    return () => { vigente = false }
  }, [])

  const sociedadesFiltradas = sociedades.filter(s => 
    s.nombre.toLowerCase().includes(busqueda.toLowerCase()) || 
    (s.iglesia || '').toLowerCase().includes(busqueda.toLowerCase())
  )

  const handleCrearSociedad = async (e) => {
    e.preventDefault()
    setError('')
    setCargando(true)
    try {
      const { data, error } = await supabase
        .from('sociedades')
        .insert([{
          nombre: nuevaSociedad.nombre,
          iglesia: nuevaSociedad.iglesia,
        }])
        .select()
        .single()

      if (error) throw error
      
      setSociedades([...sociedades, data].sort((a, b) => a.nombre.localeCompare(b.nombre)))
      setSociedadSeleccionada(data)
      setMostrandoFormNueva(false)
      setPaso(2)
    } catch (err) {
      setError(err.message || 'Error al crear la sociedad')
    } finally {
      setCargando(false)
    }
  }

  const handleAgregarParticipante = (e) => {
    e.preventDefault()
    if (!nuevoParticipante.nombre.trim()) return
    
    setParticipantes([...participantes, { ...nuevoParticipante, id: Date.now() }])
    setNuevoParticipante({ nombre: '', del_censo: false })
  }

  const handleEliminarParticipante = (id) => {
    setParticipantes(participantes.filter(p => p.id !== id))
  }

  const handleCrearSesion = async () => {
    setError('')
    setCargando(true)
    
    try {
      const { data: sesionData, error: sesionError } = await supabase.rpc('admin_examen_crear_sesion', {
        p_etapa: etapa.id,
        p_sociedad: sociedadSeleccionada.id,
        p_participantes: participantes.map(p => ({ nombre: p.nombre, del_censo: p.del_censo })),
      })
      if (sesionError) throw sesionError

      // 3. Redirigir a sala de espera
      navigate(`/admin/sesion/${sesionData.sesion_id}/espera`)
      
    } catch (err) {
      setError(err.message || 'Error al generar la sesión completa')
      setCargando(false)
    }
  }

  return (
    <div className="page-wrapper" style={{ padding: 'var(--space-md)' }}>
      <div className="page-content animate-in" style={{ maxWidth: '600px', width: '100%' }}>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-xl)' }}>
          <button onClick={() => navigate('/admin/dashboard')} className="btn btn-secondary" style={{ padding: '0.5rem', minWidth: 'auto' }}>
            <ArrowLeft size={20} />
          </button>
          <h1 className="brand-title" style={{ fontSize: '1.5rem', marginBottom: 0 }}>Nueva Sesión</h1>
        </div>

        <EtapaAviso />
        {/* Indicador de pasos */}
        <div style={{ display: 'flex', gap: 'var(--space-sm)', marginBottom: 'var(--space-xl)' }}>
          {[1, 2, 3].map(i => (
            <div key={i} style={{ 
              flex: 1, 
              height: '4px', 
              borderRadius: '2px',
              background: paso >= i ? 'var(--color-primary)' : 'var(--color-bg-hover)' 
            }} />
          ))}
        </div>

        {error && (
          <div className="alert alert-error">
            <span>{error}</span>
          </div>
        )}

        <div className="card">
          
          {/* PASO 1: SOCIEDAD */}
          {paso === 1 && (
            <div className="animate-in">
              <h2 style={{ fontSize: '1.2rem', marginBottom: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: 'var(--color-accent)' }}>1.</span> Seleccionar Sociedad
              </h2>
              
              {!mostrandoFormNueva ? (
                <>
                  <div className="form-group" style={{ position: 'relative' }}>
                    <Search size={18} style={{ position: 'absolute', top: '14px', left: '12px', color: 'var(--color-text-muted)' }} />
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Buscar sociedad o iglesia..."
                      value={busqueda}
                      onChange={(e) => setBusqueda(e.target.value)}
                      style={{ paddingLeft: '40px' }}
                    />
                  </div>

                  <div style={{ maxHeight: '300px', overflowY: 'auto', background: 'var(--color-bg-base)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
                    {sociedadesFiltradas.length === 0 ? (
                      <div style={{ padding: 'var(--space-md)', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                        No se encontraron resultados
                      </div>
                    ) : (
                      sociedadesFiltradas.map(soc => (
                        <div 
                          key={soc.id}
                          onClick={() => { setSociedadSeleccionada(soc); setPaso(2); }}
                          style={{ 
                            padding: 'var(--space-md)', 
                            borderBottom: '1px solid var(--color-border)',
                            cursor: 'pointer',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            transition: 'background var(--transition-fast)'
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-hover)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                          <div>
                            <div style={{ fontWeight: 600 }}>{soc.nombre}</div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{soc.iglesia}</div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="divider" />
                  <button onClick={() => setMostrandoFormNueva(true)} className="btn btn-secondary" style={{ width: '100%' }}>
                    <Plus size={16} /> Crear nueva sociedad
                  </button>
                </>
              ) : (
                <form onSubmit={handleCrearSociedad}>
                  <div className="form-group">
                    <label className="form-label">Nombre de la Sociedad / Grupo</label>
                    <input required type="text" className="form-input" value={nuevaSociedad.nombre} onChange={e => setNuevaSociedad({...nuevaSociedad, nombre: e.target.value})} placeholder="Ej: Jóvenes Vencedores" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Iglesia a la que pertenece</label>
                    <input required type="text" className="form-input" value={nuevaSociedad.iglesia} onChange={e => setNuevaSociedad({...nuevaSociedad, iglesia: e.target.value})} placeholder="Ej: INELA Central" />
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--space-md)' }}>
                    <button type="button" onClick={() => setMostrandoFormNueva(false)} className="btn btn-secondary" style={{ flex: 1 }}>Cancelar</button>
                    <button type="submit" disabled={cargando} className="btn btn-primary" style={{ flex: 1 }}>
                      {cargando ? 'Guardando...' : 'Guardar y Continuar'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}


          {/* PASO 2: PARTICIPANTES */}
          {paso === 2 && (
            <div className="animate-in">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-md)' }}>
                <h2 style={{ fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                  <span style={{ color: 'var(--color-accent)' }}>2.</span> Participantes
                </h2>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>{sociedadSeleccionada?.nombre}</div>
                </div>
              </div>

              <form onSubmit={handleAgregarParticipante} style={{ display: 'flex', gap: 'var(--space-sm)', marginBottom: 'var(--space-lg)' }}>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Nombre del participante..."
                  value={nuevoParticipante.nombre}
                  onChange={e => setNuevoParticipante({...nuevoParticipante, nombre: e.target.value})}
                  style={{ flex: 1 }}
                />
                <button type="submit" aria-label="Agregar participante" className="btn btn-primary" style={{ padding: '0 1rem', width: 'auto' }}>
                  <Plus size={18} />
                </button>
              </form>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '250px', overflowY: 'auto', marginBottom: 'var(--space-lg)' }}>
                {participantes.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 'var(--space-lg)', color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
                    Sin participantes agregados.
                  </div>
                ) : (
                  participantes.map((p, idx) => (
                    <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: 'var(--color-bg-base)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>
                      <div>
                        <div style={{ fontSize: '0.95rem' }}>{idx + 1}. {p.nombre}</div>
                      </div>
                      <button onClick={() => handleEliminarParticipante(p.id)} style={{ background: 'none', border: 'none', color: 'var(--color-error)', cursor: 'pointer', padding: '4px' }}>
                        <Trash2 size={18} />
                      </button>
                    </div>
                  ))
                )}
              </div>

              <div style={{ display: 'flex', gap: 'var(--space-md)' }}>
                <button onClick={() => setPaso(1)} className="btn btn-secondary" style={{ flex: 1 }}>Atrás</button>
                <button onClick={() => setPaso(3)} disabled={participantes.length === 0} className="btn btn-primary" style={{ flex: 1 }}>Continuar</button>
              </div>
            </div>
          )}


          {/* PASO 3: CONFIGURACIÓN */}
          {paso === 3 && (
            <div className="animate-in">
              <h2 style={{ fontSize: '1.2rem', marginBottom: 'var(--space-lg)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: 'var(--color-accent)' }}>3.</span> Configuración de Examen
              </h2>

              <dl className="etapa-stats"><div><dt>Duración de la etapa</dt><dd>{configuracion.tiempo_limite} min</dd></div><div><dt>Preguntas por joven</dt><dd>{configuracion.cant_preguntas}</dd></div></dl>
              <p className="etapa-help">Estos valores se definen en la configuración de la etapa.</p>

              <div className="divider" />

              <div style={{ display: 'flex', gap: 'var(--space-md)' }}>
                <button onClick={() => setPaso(2)} className="btn btn-secondary" style={{ flex: 1 }}>Atrás</button>
                <button onClick={handleCrearSesion} disabled={cargando} className="btn btn-primary" style={{ flex: 2 }}>
                  {cargando ? 'Generando...' : 'Crear y Generar QR'}
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
