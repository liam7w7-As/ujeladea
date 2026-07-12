import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { QRCodeSVG } from 'qrcode.react'
import { ArrowLeft, Play, Square, Users, Clock, CheckCircle2, Circle, AlertTriangle, ShieldAlert, Trash2 } from 'lucide-react'
import Modal from '../../components/Modal'

export default function SalaEspera() {
  const { id } = useParams()
  const navigate = useNavigate()
  
  const [sesion, setSesion] = useState(null)
  const [participantes, setParticipantes] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [tiempoRestante, setTiempoRestante] = useState(null)
  
  // Seguridad
  const [alertas, setAlertas] = useState({})
  const [modalAlerta, setModalAlerta] = useState({ isOpen: false, participante: null, detalle: [] })



  // Modal para confirmaciones
  const [modalConfirm, setModalConfirm] = useState({ isOpen: false, titulo: '', mensaje: '', tipo: 'info', isConfirm: false, onConfirm: null })

  useEffect(() => {
    cargarDatos()
    
    // Generamos IDs únicos para evitar colisiones en StrictMode
    const pid = `participantes_sesion_${id}_${Math.random().toString(36).substring(7)}`
    const canalParticipantes = supabase.channel(pid)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'participantes',
          filter: `sesion_id=eq.${id}`
        },
        (payload) => {
          setParticipantes(actuales => 
            actuales.map(p => p.id === payload.new.id ? { ...p, ...payload.new } : p)
          )
        }
      )
      .subscribe()

    const sid = `sesion_${id}_${Math.random().toString(36).substring(7)}`
    const canalSesion = supabase.channel(sid)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'sesiones', filter: `id=eq.${id}` },
        (payload) => setSesion(payload.new)
      ).subscribe()

    // Cargar alertas iniciales
    const cargarAlertas = async () => {
      const { data } = await supabase.from('resumen_alertas').select('*').eq('sesion_id', id)
      if (data) {
        const mapa = {}
        data.forEach(r => { mapa[r.participante_id] = { total: r.total_eventos, detalle: r.detalle } })
        setAlertas(mapa)
      }
    }
    cargarAlertas()

    // Suscripción a eventos de seguridad
    const eid = `eventos_${id}_${Math.random().toString(36).substring(7)}`
    const canalEventos = supabase.channel(eid)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'eventos_sesion', filter: `sesion_id=eq.${id}` },
        () => cargarAlertas()
      ).subscribe()

    return () => {
      supabase.removeChannel(canalParticipantes)
      supabase.removeChannel(canalSesion)
      supabase.removeChannel(canalEventos)
    }
  }, [id])

  // Temporizador
  useEffect(() => {
    if (!sesion || sesion.estado !== 'activo' || !sesion.iniciado_at) return
    
    const calcularTiempo = () => {
      const inicio = new Date(sesion.iniciado_at).getTime()
      const ahora = new Date().getTime()
      const transcurrido = ahora - inicio
      const limiteMs = sesion.tiempo_limite * 60 * 1000
      
      const restante = limiteMs - transcurrido
      if (restante <= 0) {
        setTiempoRestante(0)
        handleFinalizarExamen()
      } else {
        setTiempoRestante(restante)
      }
    }

    calcularTiempo()
    const intervalo = setInterval(calcularTiempo, 1000)
    return () => clearInterval(intervalo)
  }, [sesion])

  const cargarDatos = async () => {
    try {
      setCargando(true)
      // Cargar sesión
      const { data: dataSesion, error: errorSesion } = await supabase
        .from('sesiones')
        .select('*, sociedades(nombre, total_censo)')
        .eq('id', id)
        .single()
      
      if (errorSesion) throw errorSesion
      setSesion(dataSesion)

      // Cargar participantes
      const { data: dataPart, error: errorPart } = await supabase
        .from('participantes')
        .select('*')
        .eq('sesion_id', id)
        .order('nombre')
      
      if (errorPart) throw errorPart
      setParticipantes(dataPart)
      
    } catch (err) {
      setError('Error al cargar la sala de espera')
    } finally {
      setCargando(false)
    }
  }

  const handleIniciarExamen = () => {
    setModalConfirm({
      isOpen: true,
      titulo: 'Iniciar Examen',
      mensaje: '¿Estás seguro de iniciar el examen para todos los jóvenes registrados?',
      tipo: 'info',
      isConfirm: true,
      onConfirm: ejecutarIniciarExamen
    })
  }

  const ejecutarIniciarExamen = async () => {
    setModalConfirm(prev => ({ ...prev, isOpen: false }))
    try {
      const { error } = await supabase
        .from('sesiones')
        .update({ 
          estado: 'activo',
          iniciado_at: new Date().toISOString()
        })
        .eq('id', id)
      
      if (error) throw error
    } catch (err) {
      setModalConfirm({ isOpen: true, titulo: 'Error', mensaje: 'Error al iniciar: ' + err.message, tipo: 'error', isConfirm: false, onConfirm: null })
    }
  }



  const handleEliminarParticipante = (pid) => {
    setModalConfirm({
      isOpen: true,
      titulo: 'Eliminar Participante',
      mensaje: '¿Seguro que deseas eliminar a este participante?',
      tipo: 'error',
      isConfirm: true,
      onConfirm: () => ejecutarEliminarParticipante(pid)
    })
  }

  const ejecutarEliminarParticipante = async (pid) => {
    setModalConfirm(prev => ({ ...prev, isOpen: false }))
    try {
      const { error } = await supabase.from('participantes').delete().eq('id', pid)
      if (error) throw error
      setParticipantes(actuales => actuales.filter(p => p.id !== pid))
    } catch (err) {
      setModalConfirm({ isOpen: true, titulo: 'Error', mensaje: 'Error al eliminar: ' + err.message, tipo: 'error', isConfirm: false, onConfirm: null })
    }
  }

  const handleFinalizarExamen = () => {
    if (sesion.estado === 'finalizado') return
    if (tiempoRestante > 0) {
      setModalConfirm({
        isOpen: true,
        titulo: 'Forzar Finalización',
        mensaje: '¿Estás seguro de forzar la finalización del examen? Aún queda tiempo restante.',
        tipo: 'warning',
        isConfirm: true,
        onConfirm: ejecutarFinalizarExamen
      })
    } else {
      ejecutarFinalizarExamen()
    }
  }

  const ejecutarFinalizarExamen = async () => {
    setModalConfirm(prev => ({ ...prev, isOpen: false }))
    try {
      const { error } = await supabase
        .from('sesiones')
        .update({ 
          estado: 'finalizado',
          finalizado_at: new Date().toISOString()
        })
        .eq('id', id)
      
      if (error) throw error
      navigate(`/admin/sesion/${id}/resultados`)
    } catch (err) {
      setModalConfirm({ isOpen: true, titulo: 'Error', mensaje: 'Error al finalizar: ' + err.message, tipo: 'error', isConfirm: false, onConfirm: null })
    }
  }

  const urlExamen = `${window.location.origin}/examen/${id}`
  const registradosCount = participantes.filter(p => p.registrado_at).length
  
  const formatoTiempo = (ms) => {
    if (ms === null) return '--:--'
    const totalSegundos = Math.floor(ms / 1000)
    const minutos = Math.floor(totalSegundos / 60)
    const segundos = totalSegundos % 60
    return `${minutos.toString().padStart(2, '0')}:${segundos.toString().padStart(2, '0')}`
  }

  if (cargando) return <div className="page-wrapper"><div className="spinner" /></div>
  if (!sesion) return <div className="page-wrapper"><div className="alert alert-error">Sesión no encontrada</div></div>

  return (
    <div className="page-wrapper" style={{ padding: 'var(--space-md)' }}>
      <div className="page-content animate-in" style={{ maxWidth: '800px', width: '100%' }}>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)' }}>
          <button onClick={() => navigate('/admin/dashboard')} className="btn btn-secondary" style={{ padding: '0.5rem', minWidth: 'auto' }}>
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="brand-title" style={{ fontSize: '1.5rem', marginBottom: 0 }}>Sala de Control</h1>
            <p style={{ color: 'var(--color-accent)', fontSize: '0.9rem' }}>{sesion.sociedades?.nombre}</p>
          </div>
        </div>

        {sesion.estado === 'finalizado' && (
          <div className="alert alert-success" style={{ marginBottom: 'var(--space-lg)' }}>
            El examen ha finalizado. 
            <button className="btn btn-primary" onClick={() => navigate(`/admin/sesion/${id}/resultados`)} style={{ marginLeft: 'var(--space-md)', padding: '0.2rem 0.8rem', width: 'auto' }}>Ver Resultados</button>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 'var(--space-lg)' }}>
          
          {/* PANEL IZQUIERDO: QR Y CONTROLES */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
            {sesion.estado === 'esperando' ? (
              <>
                <h3 style={{ marginBottom: 'var(--space-md)' }}>Escanear para unirse</h3>
                <div style={{ background: '#fff', padding: '16px', borderRadius: '16px', marginBottom: 'var(--space-lg)', display: 'inline-block' }}>
                  <QRCodeSVG value={urlExamen} size={200} fgColor="#8f1937" />
                </div>
                <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: 'var(--space-xl)', wordBreak: 'break-all' }}>
                  {urlExamen}
                </p>

                <div style={{ width: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-xs)' }}>
                    <span style={{ fontSize: '0.9rem' }}>Registrados</span>
                    <span style={{ fontSize: '0.9rem', color: 'var(--color-accent)' }}>{registradosCount} / {participantes.length}</span>
                  </div>
                  <div style={{ width: '100%', height: '8px', background: 'var(--color-bg-base)', borderRadius: '4px', overflow: 'hidden', marginBottom: 'var(--space-lg)' }}>
                    <div style={{ width: `${participantes.length > 0 ? (registradosCount / participantes.length) * 100 : 0}%`, height: '100%', background: 'var(--color-accent)', transition: 'width 0.3s ease' }} />
                  </div>

                  <button 
                    onClick={handleIniciarExamen} 
                    disabled={registradosCount === 0}
                    className="btn btn-primary"
                    style={{ padding: '1rem' }}
                  >
                    <Play size={20} />
                    INICIAR EXAMEN
                  </button>
                </div>
              </>
            ) : (
              <>
                <Clock size={48} color="var(--color-accent)" style={{ marginBottom: 'var(--space-md)' }} />
                <h3 style={{ marginBottom: 'var(--space-xs)' }}>Tiempo Restante</h3>
                <div style={{ fontSize: '3rem', fontFamily: 'var(--font-heading)', color: tiempoRestante < 60000 ? 'var(--color-error)' : 'var(--color-text-primary)', marginBottom: 'var(--space-xl)', fontWeight: 700 }}>
                  {formatoTiempo(tiempoRestante)}
                </div>
                
                <button 
                  onClick={handleFinalizarExamen}
                  disabled={sesion.estado === 'finalizado'}
                  className="btn btn-secondary" 
                  style={{ color: 'var(--color-error)', borderColor: 'rgba(192, 57, 43, 0.3)', width: '100%' }}
                >
                  <Square size={18} />
                  Finalizar Examen Ahora
                </button>
              </>
            )}
          </div>

          {/* PANEL DERECHO: PARTICIPANTES */}
          <div className="card" style={{ padding: 'var(--space-md)' }}>
            <h3 style={{ fontSize: '1.1rem', marginBottom: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Users size={18} color="var(--color-accent)" />
              Participantes ({participantes.length})
            </h3>
            


            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '400px', overflowY: 'auto', paddingRight: '4px' }}>
              {participantes.map(p => {
                let statusColor = 'var(--color-text-muted)'
                let statusIcon = <Circle size={14} />
                let statusText = 'Esperando'

                if (p.examen_finalizado) {
                  statusColor = 'var(--color-success)'
                  statusIcon = <CheckCircle2 size={14} />
                  statusText = 'Terminó'
                } else if (p.registrado_at) {
                  statusColor = 'var(--color-warning)'
                  statusIcon = <CheckCircle2 size={14} />
                  statusText = 'En línea'
                }

                // Logica de alertas anti-trampa
                const alertaInfo = alertas[p.id]
                const tieneAlertas = alertaInfo && alertaInfo.total > 0
                const esGrave = tieneAlertas && alertaInfo.total >= 3
                
                return (
                  <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: esGrave ? 'rgba(231, 76, 60, 0.05)' : 'var(--color-bg-base)', borderRadius: 'var(--radius-sm)', border: `1px solid ${esGrave ? 'rgba(231, 76, 60, 0.3)' : 'var(--color-border)'}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '0.95rem', fontWeight: esGrave ? 600 : 400 }}>{p.nombre}</span>
                      
                      {tieneAlertas && (
                        <button 
                          onClick={() => setModalAlerta({ isOpen: true, participante: p, detalle: alertaInfo.detalle })}
                          className={`btn ${esGrave ? 'pulse-animation' : ''}`}
                          style={{ padding: '2px 6px', height: 'auto', minHeight: 'auto', fontSize: '0.75rem', background: esGrave ? 'var(--color-error)' : 'var(--color-warning)', color: 'white', border: 'none', display: 'flex', alignItems: 'center', gap: '4px', borderRadius: '12px' }}
                        >
                          <AlertTriangle size={12} />
                          {alertaInfo.total} alertas
                        </button>
                      )}
                    </div>
                    
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: statusColor, background: 'var(--color-bg-surface)', padding: '2px 8px', borderRadius: '12px' }}>
                      {statusIcon}
                      {statusText}
                      {sesion.estado === 'esperando' && !p.registrado_at && (
                        <button 
                          onClick={() => handleEliminarParticipante(p.id)}
                          style={{ background: 'none', border: 'none', color: 'var(--color-error)', cursor: 'pointer', marginLeft: '4px', display: 'flex' }}
                          title="Eliminar participante"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
            
            {sesion.estado === 'activo' && Object.keys(alertas).length > 0 && (
              <div style={{ marginTop: 'var(--space-md)', padding: 'var(--space-sm)', background: 'rgba(231, 76, 60, 0.1)', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-error)', fontSize: '0.85rem' }}>
                <ShieldAlert size={16} />
                <span>Hay participantes con alertas de seguridad detectadas. Haz clic en las etiquetas para ver detalles.</span>
              </div>
            )}
          </div>

        </div>
      </div>

      <Modal 
        isOpen={modalAlerta.isOpen}
        onClose={() => setModalAlerta({ isOpen: false, participante: null, detalle: [] })}
        titulo={`Alertas de Seguridad`}
        tipo="warning"
        mensaje=""
      >
        {modalAlerta.participante && (
          <div style={{ marginTop: '-10px' }}>
            <p style={{ marginBottom: '16px' }}>
              Participante: <strong>{modalAlerta.participante.nombre}</strong>
            </p>
            <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
              <table style={{ width: '100%', fontSize: '0.9rem', textAlign: 'left', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--color-bg-surface)' }}>
                    <th style={{ padding: '8px', borderBottom: '1px solid var(--color-border)' }}>Evento</th>
                    <th style={{ padding: '8px', borderBottom: '1px solid var(--color-border)' }}>Veces</th>
                    <th style={{ padding: '8px', borderBottom: '1px solid var(--color-border)' }}>Última vez</th>
                  </tr>
                </thead>
                <tbody>
                  {modalAlerta.detalle.map((d, i) => (
                    <tr key={i}>
                      <td style={{ padding: '8px', borderBottom: '1px solid var(--color-border)' }}>
                        {d.tipo === 'salio_fullscreen' ? 'Salió de Pantalla Completa' : 
                         d.tipo === 'cambio_pestana' ? 'Minimizó o Cambió Pestaña' : 
                         d.tipo === 'intento_copiar' ? 'Intentó Copiar (Ctrl+C)' :
                         d.tipo === 'devtools_detectado' ? 'Atajo de Desarrollador' : d.tipo}
                      </td>
                      <td style={{ padding: '8px', borderBottom: '1px solid var(--color-border)' }}>{d.cantidad}</td>
                      <td style={{ padding: '8px', borderBottom: '1px solid var(--color-border)' }}>{new Date(d.ultimo_at).toLocaleTimeString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ marginTop: '16px', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
              <em>Nota: El encargado presente puede verificar personalmente si el participante está haciendo trampa. El sistema solo registra estos eventos y no bloquea el examen automáticamente.</em>
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
              <button onClick={() => setModalAlerta({ isOpen: false, participante: null, detalle: [] })} className="btn btn-primary" style={{ width: 'auto' }}>Entendido</button>
            </div>
          </div>
        )}
      </Modal>

      <Modal 
        isOpen={modalConfirm.isOpen}
        onClose={() => setModalConfirm(prev => ({ ...prev, isOpen: false }))}
        titulo={modalConfirm.titulo}
        mensaje={modalConfirm.mensaje}
        tipo={modalConfirm.tipo}
        isConfirm={modalConfirm.isConfirm}
        onConfirm={modalConfirm.onConfirm}
        textoConfirmar={modalConfirm.isConfirm ? "Sí, confirmar" : "Aceptar"}
      />

      <style>{`
        @keyframes pulseAlert {
          0% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.8; transform: scale(1.05); }
          100% { opacity: 1; transform: scale(1); }
        }
        .pulse-animation {
          animation: pulseAlert 1.5s infinite;
        }
      `}</style>
    </div>
  )
}
