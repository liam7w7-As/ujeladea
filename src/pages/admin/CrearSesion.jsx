import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { ArrowLeft, Search, Plus, Trash2, CheckCircle2, AlertTriangle, Users } from 'lucide-react'

export default function CrearSesion() {
  const navigate = useNavigate()
  const [paso, setPaso] = useState(1)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')

  // Datos de sociedades
  const [sociedades, setSociedades] = useState([])
  const [busqueda, setBusqueda] = useState('')
  const [sociedadSeleccionada, setSociedadSeleccionada] = useState(null)
  
  // Datos nueva sociedad (si no existe)
  const [nuevaSociedad, setNuevaSociedad] = useState({ nombre: '', iglesia: '', total_censo: '' })
  const [mostrandoFormNueva, setMostrandoFormNueva] = useState(false)

  // Datos de participantes
  const [participantes, setParticipantes] = useState([])
  const [nuevoParticipante, setNuevoParticipante] = useState({ nombre: '', del_censo: false })

  // Configuración de examen
  const [configuracion, setConfiguracion] = useState({ tiempo_limite: 60, cant_preguntas: 45 })

  useEffect(() => {
    cargarSociedades()
  }, [])

  const cargarSociedades = async () => {
    const { data, error } = await supabase.from('sociedades').select('*').order('nombre')
    if (!error && data) setSociedades(data)
  }

  const sociedadesFiltradas = sociedades.filter(s => 
    s.nombre.toLowerCase().includes(busqueda.toLowerCase()) || 
    s.iglesia.toLowerCase().includes(busqueda.toLowerCase())
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
          total_censo: nuevaSociedad.total_censo ? parseInt(nuevaSociedad.total_censo) : null
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

  const participantesDelCenso = participantes.filter(p => p.del_censo).length

  const handleCrearSesion = async () => {
    setError('')
    setCargando(true)
    
    try {
      // 1. Crear sesión
      const { data: sesionData, error: sesionError } = await supabase
        .from('sesiones')
        .insert([{
          sociedad_id: sociedadSeleccionada.id,
          estado: 'esperando',
          tiempo_limite: configuracion.tiempo_limite,
          cantidad_preguntas: configuracion.cant_preguntas
        }])
        .select()
        .single()

      if (sesionError) throw sesionError

      // 2. Crear participantes
      if (participantes.length > 0) {
        const participantesInsert = participantes.map(p => ({
          sesion_id: sesionData.id,
          nombre: p.nombre,
          del_censo: p.del_censo,
          examen_finalizado: false,
          puntaje_total: 0
        }))

        const { error: partError } = await supabase
          .from('participantes')
          .insert(participantesInsert)

        if (partError) throw partError
      }

      // 3. Redirigir a sala de espera
      navigate(`/admin/sesion/${sesionData.id}/espera`)
      
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
                          <div style={{ fontSize: '0.85rem', color: 'var(--color-accent)', background: 'var(--color-accent-muted)', padding: '2px 8px', borderRadius: '12px' }}>
                            Censo: {soc.total_censo}
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
                  <div className="form-group">
                    <label className="form-label">Total del Censo <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>(opcional)</span></label>
                    <input type="text" inputMode="numeric" pattern="[0-9]*" className="form-input" value={nuevaSociedad.total_censo} onChange={e => setNuevaSociedad({...nuevaSociedad, total_censo: e.target.value.replace(/[^0-9]/g, '')})} placeholder="Ej: 15" />
                    <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '4px' }}>Solo informativo. Puedes dejarlo vacío.</p>
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
                  {sociedadSeleccionada?.total_censo ? (
                    <div style={{ fontSize: '0.8rem', color: 'var(--color-accent)' }}>Censo oficial: {sociedadSeleccionada.total_censo}</div>
                  ) : null}
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
                <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', color: 'var(--color-text-muted)', background: 'var(--color-bg-base)', padding: '0 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', cursor: 'pointer' }}>
                  <input 
                    type="checkbox" 
                    checked={nuevoParticipante.del_censo}
                    onChange={e => setNuevoParticipante({...nuevoParticipante, del_censo: e.target.checked})}
                  />
                  Es del censo
                </label>
                <button type="submit" className="btn btn-primary" style={{ padding: '0 1rem', width: 'auto' }}>
                  <Plus size={18} />
                </button>
              </form>

              {participantesDelCenso < sociedadSeleccionada?.total_censo && (
                <div className="alert" style={{ background: 'rgba(212, 160, 23, 0.1)', color: 'var(--color-warning)', border: '1px solid rgba(212, 160, 23, 0.2)' }}>
                  <AlertTriangle size={16} />
                  <span>Faltan {sociedadSeleccionada?.total_censo - participantesDelCenso} jóvenes del censo (afectará el puntaje final).</span>
                </div>
              )}

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
                        <div style={{ fontSize: '0.75rem', color: p.del_censo ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
                          {p.del_censo ? 'Cuenta para el censo' : 'Invitado (no afecta censo)'}
                        </div>
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

              <div className="form-group">
                <label className="form-label">Tiempo límite (minutos)</label>
                <select 
                  className="form-input" 
                  value={configuracion.tiempo_limite}
                  onChange={e => setConfiguracion({...configuracion, tiempo_limite: parseInt(e.target.value)})}
                >
                  <option value="30">30 minutos</option>
                  <option value="45">45 minutos</option>
                  <option value="60">60 minutos</option>
                  <option value="90">90 minutos</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Cantidad de preguntas por joven</label>
                <select 
                  className="form-input" 
                  value={configuracion.cant_preguntas}
                  onChange={e => setConfiguracion({...configuracion, cant_preguntas: parseInt(e.target.value)})}
                >
                  <option value="10">10 preguntas</option>
                  <option value="15">15 preguntas</option>
                  <option value="20">20 preguntas</option>
                  <option value="25">25 preguntas</option>
                  <option value="30">30 preguntas</option>
                  <option value="35">35 preguntas</option>
                  <option value="40">40 preguntas</option>
                  <option value="45">45 preguntas</option>
                  <option value="50">50 preguntas</option>
                </select>
                <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                  Cada joven recibirá esta cantidad de preguntas seleccionadas aleatoriamente del banco general.
                </p>
              </div>

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
