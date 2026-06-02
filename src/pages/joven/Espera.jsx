import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { generarExamen } from '../../lib/examen'
import Modal from '../../components/Modal'
import { Users } from 'lucide-react'

const VERSICULOS = [
  { texto: "Todo lo puedo en Cristo que me fortalece.", cita: "Filipenses 4:13" },
  { texto: "Fíate de Jehová de todo tu corazón, y no te apoyes en tu propia prudencia.", cita: "Proverbios 3:5" },
  { texto: "Lámpara es a mis pies tu palabra, y lumbrera a mi camino.", cita: "Salmos 119:105" },
  { texto: "Mira que te mando que te esfuerces y seas valiente; no temas ni desmayes.", cita: "Josué 1:9" },
  { texto: "Porque yo sé los pensamientos que tengo acerca de vosotros, dice Jehová, pensamientos de paz, y no de mal.", cita: "Jeremías 29:11" }
]

export default function Espera() {
  const { sesionId } = useParams()
  const navigate = useNavigate()
  
  const [participante, setParticipante] = useState(null)
  const [sesion, setSesion] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [modal, setModal] = useState({ isOpen: false, titulo: '', mensaje: '', tipo: 'info' })
  const [versiculoActual, setVersiculoActual] = useState(0)
  const [conectados, setConectados] = useState(1) // Al menos él mismo

  useEffect(() => {
    const partId = localStorage.getItem(`torneo_participante_${sesionId}`)
    if (!partId) {
      navigate(`/examen/${sesionId}`)
      return
    }

    cargarDatos(partId)
    
    // Rotar versículo cada 10s
    const intervalVersiculos = setInterval(() => {
      setVersiculoActual(prev => (prev + 1) % VERSICULOS.length)
    }, 10000)

    return () => clearInterval(intervalVersiculos)
  }, [sesionId, navigate])

  const cargarDatos = async (partId) => {
    try {
      // 1. Cargar participante
      const { data: dataPart, error: errPart } = await supabase
        .from('participantes')
        .select('*')
        .eq('id', partId)
        .single()
      
      if (errPart || !dataPart) throw new Error('Participante no encontrado')
      
      if (dataPart.examen_finalizado) {
        navigate(`/examen/${sesionId}/finalizado`)
        return
      }
      setParticipante(dataPart)

      // 2. Cargar sesión
      const { data: dataSesion, error: errSesion } = await supabase
        .from('sesiones')
        .select('*, sociedades(nombre)')
        .eq('id', sesionId)
        .single()
      
      if (errSesion) throw errSesion
      setSesion(dataSesion)

      // Si ya está activo, procesar examen
      if (dataSesion.estado === 'activo') {
        prepararExamenYRedirigir(dataPart.seed, dataSesion.cantidad_preguntas || 15)
        return
      }

      // Si está finalizado
      if (dataSesion.estado === 'finalizado') {
        navigate(`/examen/${sesionId}/finalizado`)
        return
      }

      setCargando(false)

      // 3. Suscribirse a cambios si sigue en espera (Con Presence para los conectados)
      // Agregamos sufijo aleatorio para evitar conflictos StrictMode
      const canalId = `sesion_joven_${sesionId}_${Math.random().toString(36).substring(7)}`
      const canalSesion = supabase.channel(canalId, {
        config: { presence: { key: partId } }
      })

      canalSesion
        .on('presence', { event: 'sync' }, () => {
          const state = canalSesion.presenceState()
          // Contar el total de usuarios conectados en este canal
          let totalConectados = 0
          for (const key in state) {
            totalConectados += state[key].length
          }
          setConectados(totalConectados)
        })
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'sesiones', filter: `id=eq.${sesionId}` },
          (payload) => {
            if (payload.new.estado === 'activo') {
              prepararExamenYRedirigir(dataPart.seed, payload.new.cantidad_preguntas || 15)
            } else if (payload.new.estado === 'finalizado') {
              navigate(`/examen/${sesionId}/finalizado`)
            }
          }
        )
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            await canalSesion.track({ id: partId, online_at: new Date().toISOString() })
          }
        })

      return () => {
        supabase.removeChannel(canalSesion)
      }

    } catch (err) {
      console.error(err)
      setModal({ isOpen: true, titulo: 'Error', mensaje: 'Error al cargar la sala de espera. Por favor refresca la página.', tipo: 'error' })
    }
  }

  const prepararExamenYRedirigir = async (seed, cantidad) => {
    try {
      const ordenGuardado = localStorage.getItem(`torneo_preguntas_${sesionId}`)
      if (ordenGuardado) {
        navigate(`/examen/${sesionId}/preguntas`)
        return
      }

      const { data: preguntas, error } = await supabase
        .from('preguntas')
        .select('id')
        .eq('activa', true)

      if (error) throw error

      const subconjunto = generarExamen(preguntas, parseInt(seed), cantidad)
      
      const ordenIds = subconjunto.map(p => p.id)
      localStorage.setItem(`torneo_preguntas_${sesionId}`, JSON.stringify(ordenIds))

      navigate(`/examen/${sesionId}/preguntas`)
    } catch (err) {
      console.error(err)
      setModal({ isOpen: true, titulo: 'Error', mensaje: 'Error al generar el examen. Avisa al administrador.', tipo: 'error' })
    }
  }

  if (cargando) {
    return (
      <div className="page-wrapper" style={{ padding: 'var(--space-md)' }}>
        <div className="page-content animate-in" style={{ textAlign: 'center' }}>
          <div className="card" style={{ padding: 'var(--space-3xl) var(--space-xl)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div className="skeleton" style={{ width: '100px', height: '100px', borderRadius: '50%', marginBottom: 'var(--space-xl)' }}></div>
            <div className="skeleton" style={{ width: '200px', height: '28px', marginBottom: 'var(--space-xs)' }}></div>
            <div className="skeleton" style={{ width: '150px', height: '16px', marginBottom: 'var(--space-2xl)' }}></div>
            <div className="skeleton" style={{ width: '60px', height: '60px', borderRadius: '50%', marginBottom: 'var(--space-xl)' }}></div>
            <div className="skeleton" style={{ width: '250px', height: '24px', marginBottom: 'var(--space-sm)' }}></div>
            <div className="skeleton" style={{ width: '300px', height: '40px' }}></div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page-wrapper" style={{ padding: 'var(--space-md)' }}>
      
      {/* Contador de conectados Flotante */}
      <div className="fade-in" style={{ position: 'absolute', top: 'var(--space-md)', right: 'var(--space-md)', background: 'var(--color-bg-raised)', padding: '8px 16px', borderRadius: 'var(--radius-xl)', border: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: '8px', zIndex: 10 }}>
        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--color-success)', boxShadow: '0 0 8px var(--color-success)' }}></div>
        <Users size={14} color="var(--color-text-muted)" />
        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>{conectados} conectados</span>
      </div>

      <div className="page-content animate-in" style={{ textAlign: 'center' }}>
        
        <div className="card" style={{ padding: 'var(--space-3xl) var(--space-xl)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          
          <div className="brand-icon" style={{ background: 'transparent', boxShadow: 'none', marginBottom: 'var(--space-xl)' }}>
            <img src="/logo.png" alt="Torneo Bíblico Logo" style={{ width: '100px', height: '100px', borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--color-accent)', boxShadow: 'var(--shadow-glow)' }} />
          </div>

          <h2 style={{ fontSize: '1.4rem', marginBottom: 'var(--space-xs)' }}>
            Hola, {participante?.nombre}
          </h2>
          <p style={{ color: 'var(--color-accent)', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', fontSize: '0.85rem', marginBottom: 'var(--space-2xl)' }}>
            {sesion?.sociedades?.nombre}
          </p>

          <div style={{ position: 'relative', width: '80px', height: '80px', marginBottom: 'var(--space-2xl)' }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: '50%', border: '4px solid var(--color-primary)', borderTopColor: 'transparent', animation: 'spin 1.5s linear infinite' }} />
            <div style={{ position: 'absolute', top: '12px', left: '12px', right: '12px', bottom: '12px', borderRadius: '50%', border: '4px solid var(--color-accent)', borderBottomColor: 'transparent', opacity: 0.5, animation: 'spin 2s linear infinite reverse' }} />
            <div style={{ position: 'absolute', top: '0', left: '0', right: '0', bottom: '0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--color-accent)', animation: 'pulse-opacity 1.5s infinite' }}></div>
            </div>
          </div>

          <h3 style={{ fontSize: '1.2rem', marginBottom: 'var(--space-sm)' }}>
            El examen comenzará pronto
          </h3>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.95rem', maxWidth: '300px', marginBottom: 'var(--space-2xl)' }}>
            Mantén esta pantalla abierta. El examen iniciará automáticamente cuando el encargado dé la señal.
          </p>

          {/* Versículo del día (Rotativo) */}
          <div className="fade-in" key={versiculoActual} style={{ width: '100%', maxWidth: '320px', background: 'var(--color-bg-base)', padding: 'var(--space-md)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', borderLeft: '3px solid var(--color-primary)' }}>
            <p style={{ fontStyle: 'italic', fontSize: '0.9rem', color: 'var(--color-text-primary)', marginBottom: '8px', lineHeight: 1.5 }}>
              "{VERSICULOS[versiculoActual].texto}"
            </p>
            <p style={{ fontSize: '0.8rem', color: 'var(--color-accent)', fontWeight: 600, textAlign: 'right' }}>
              — {VERSICULOS[versiculoActual].cita}
            </p>
          </div>

        </div>
      </div>
      
      <Modal 
        isOpen={modal.isOpen} 
        onClose={() => setModal(prev => ({ ...prev, isOpen: false }))} 
        titulo={modal.titulo} 
        mensaje={modal.mensaje} 
        tipo={modal.tipo} 
      />
    </div>
  )
}
