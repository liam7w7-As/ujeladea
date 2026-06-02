import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { UserCheck, AlertCircle, ArrowRight } from 'lucide-react'

export default function Registro() {
  const { sesionId } = useParams()
  const navigate = useNavigate()
  
  const [sesion, setSesion] = useState(null)
  const [participantes, setParticipantes] = useState([])
  const [participanteSeleccionado, setParticipanteSeleccionado] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [procesando, setProcesando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    // Si ya tiene un participante guardado y es de esta sesión, redirigir directo
    const guardado = localStorage.getItem(`torneo_participante_${sesionId}`)
    if (guardado) {
      navigate(`/examen/${sesionId}/espera`)
      return
    }

    cargarDatos()
  }, [sesionId, navigate])

  const cargarDatos = async () => {
    try {
      setCargando(true)
      const { data: dataSesion, error: errSesion } = await supabase
        .from('sesiones')
        .select('*, sociedades(nombre)')
        .eq('id', sesionId)
        .single()

      if (errSesion) throw errSesion
      setSesion(dataSesion)

      // Cargar solo participantes que NO tienen seed asignado aún
      const { data: dataPart, error: errPart } = await supabase
        .from('participantes')
        .select('id, nombre')
        .eq('sesion_id', sesionId)
        .is('seed', null)
        .order('nombre')

      if (errPart) throw errPart
      setParticipantes(dataPart)
    } catch (err) {
      setError('No se pudo cargar la información de la sesión. Revisa tu conexión.')
    } finally {
      setCargando(false)
    }
  }

  const handleConfirmar = async () => {
    if (!participanteSeleccionado) return

    setProcesando(true)
    setError('')
    
    try {
      // Generar seed aleatorio de 6 a 9 dígitos
      const nuevoSeed = Math.floor(Math.random() * 900000000) + 100000

      // Actualizar en Supabase
      const { error: errUpdate } = await supabase
        .from('participantes')
        .update({ 
          seed: nuevoSeed.toString(),
          registrado_at: new Date().toISOString()
        })
        .eq('id', participanteSeleccionado.id)
        .is('seed', null) // asegurar que nadie más lo tomó al mismo tiempo

      if (errUpdate) throw errUpdate

      // Guardar en localStorage
      localStorage.setItem(`torneo_participante_${sesionId}`, participanteSeleccionado.id)
      
      // Ir a la sala de espera
      navigate(`/examen/${sesionId}/espera`)

    } catch (err) {
      setError('Hubo un error al registrarte o alguien más ya seleccionó este nombre. Intenta de nuevo.')
      cargarDatos() // recargar la lista
    } finally {
      setProcesando(false)
    }
  }

  if (cargando) return <div className="page-wrapper"><div className="spinner" /></div>
  
  if (sesion?.estado === 'finalizado') {
    return (
      <div className="page-wrapper">
        <div className="card" style={{ textAlign: 'center' }}>
          <AlertCircle size={48} color="var(--color-warning)" style={{ margin: '0 auto var(--space-md)' }} />
          <h3>Sesión Finalizada</h3>
          <p style={{ color: 'var(--color-text-muted)' }}>El examen para {sesion.sociedades?.nombre} ya ha concluido.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="page-wrapper" style={{ padding: 'var(--space-md)' }}>
      <div className="page-content animate-in">
        
        <div className="brand-header">
          <div className="brand-icon" style={{ background: 'transparent', boxShadow: 'none' }}>
            <img src="/logo.png" alt="Torneo Bíblico Logo" style={{ width: '80px', height: '80px', borderRadius: '16px', objectFit: 'cover', border: '2px solid var(--color-accent)', boxShadow: 'var(--shadow-glow)' }} />
          </div>
          <h1 className="brand-title">Torneo Bíblico</h1>
          <p className="brand-subtitle">{sesion?.sociedades?.nombre}</p>
        </div>

        <div className="card">
          <h2 style={{ fontSize: '1.2rem', marginBottom: 'var(--space-md)', textAlign: 'center' }}>Selecciona tu nombre</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', textAlign: 'center', marginBottom: 'var(--space-xl)' }}>
            Toca tu nombre en la lista para registrar tu dispositivo en el examen.
          </p>

          {error && (
            <div className="alert alert-error">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          <div style={{ maxHeight: '350px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: 'var(--space-xl)', paddingRight: '4px' }}>
            {participantes.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 'var(--space-lg)', color: 'var(--color-text-muted)' }}>
                Todos los participantes ya han sido registrados.
              </div>
            ) : (
              participantes.map(p => (
                <button
                  key={p.id}
                  onClick={() => setParticipanteSeleccionado(p)}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '16px',
                    width: '100%',
                    background: participanteSeleccionado?.id === p.id ? 'var(--color-bg-hover)' : 'var(--color-bg-base)',
                    border: `1px solid ${participanteSeleccionado?.id === p.id ? 'var(--color-accent)' : 'var(--color-border)'}`,
                    borderRadius: 'var(--radius-md)',
                    color: 'var(--color-text-primary)',
                    fontFamily: 'var(--font-body)',
                    fontSize: '1rem',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    textAlign: 'left'
                  }}
                >
                  <span>{p.nombre}</span>
                  {participanteSeleccionado?.id === p.id && <UserCheck size={20} color="var(--color-accent)" />}
                </button>
              ))
            )}
          </div>

          <button
            onClick={handleConfirmar}
            disabled={!participanteSeleccionado || procesando}
            className="btn btn-primary"
            style={{ width: '100%', padding: '1rem', fontSize: '1.05rem' }}
          >
            {procesando ? (
              <>
                <span className="spinner" /> Procesando...
              </>
            ) : (
              <>
                Soy yo, confirmar <ArrowRight size={20} />
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  )
}
