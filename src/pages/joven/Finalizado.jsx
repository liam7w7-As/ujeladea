import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { CheckCircle2, Quote } from 'lucide-react'

export default function Finalizado() {
  const { sesionId } = useParams()
  
  const [participante, setParticipante] = useState(null)
  const [sociedadNombre, setSociedadNombre] = useState('')
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    const partId = localStorage.getItem(`torneo_participante_${sesionId}`)
    if (partId) {
      cargarDatos(partId)
    } else {
      setCargando(false)
    }
  }, [sesionId])

  const cargarDatos = async (partId) => {
    try {
      const { data: dataPart } = await supabase
        .from('participantes')
        .select('*')
        .eq('id', partId)
        .single()
      
      if (dataPart) setParticipante(dataPart)

      const { data: dataSesion } = await supabase
        .from('sesiones')
        .select('sociedades(nombre)')
        .eq('id', sesionId)
        .single()

      if (dataSesion) setSociedadNombre(dataSesion.sociedades?.nombre)
      
    } catch (err) {
      console.error(err)
    } finally {
      setCargando(false)
    }
  }

  // Si acceden directo y no cargó
  if (cargando) return <div className="page-wrapper"><div className="spinner" /></div>

  return (
    <div className="page-wrapper" style={{ padding: 'var(--space-md)' }}>
      <div className="page-content animate-in" style={{ textAlign: 'center' }}>
        
        <div className="card" style={{ padding: 'var(--space-3xl) var(--space-xl)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          
          <CheckCircle2 size={80} color="var(--color-success)" style={{ marginBottom: 'var(--space-md)', filter: 'drop-shadow(0 0 20px rgba(45,138,78,0.4))' }} />

          <h1 className="brand-title" style={{ fontSize: '2rem', marginBottom: 'var(--space-xs)', color: 'var(--color-success)' }}>
            ¡Examen Finalizado!
          </h1>
          
          {participante && (
            <h2 style={{ fontSize: '1.2rem', marginBottom: 'var(--space-xs)' }}>
              Bien hecho, {participante.nombre}
            </h2>
          )}
          
          {sociedadNombre && (
            <p style={{ color: 'var(--color-accent)', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', fontSize: '0.85rem', marginBottom: 'var(--space-xl)' }}>
              {sociedadNombre}
            </p>
          )}

          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.95rem', maxWidth: '350px', marginBottom: 'var(--space-2xl)', lineHeight: 1.6 }}>
            Tus respuestas han sido guardadas de forma segura. 
            La directiva comunicará los resultados oficiales pronto.
          </p>

          <div style={{ background: 'var(--color-bg-base)', padding: 'var(--space-xl)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', position: 'relative', marginTop: 'var(--space-md)' }}>
            <Quote size={24} color="var(--color-accent)" style={{ position: 'absolute', top: '-12px', left: '20px', background: 'var(--color-bg-base)', padding: '0 4px' }} />
            <p style={{ fontStyle: 'italic', color: 'var(--color-text-primary)', fontSize: '0.95rem', lineHeight: 1.6, marginBottom: 'var(--space-md)' }}>
              "Lámpara es a mis pies tu palabra, y lumbrera a mi camino."
            </p>
            <p style={{ color: 'var(--color-accent)', fontSize: '0.85rem', fontWeight: 600 }}>
              — Salmos 119:105
            </p>
          </div>

        </div>

      </div>
    </div>
  )
}
