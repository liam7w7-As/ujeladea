import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useEtapa } from '../context/etapa-context'
import { supabase } from '../lib/supabase'
import NavAdmin from './NavAdmin'

function Mensaje({ children }) {
  return <><NavAdmin /><main className="admin-content"><div className="card etapa-message">{children}</div></main></>
}
function ComprobarSesion({ children, etapa, archivo }) {
  const { id } = useParams()
  const [estado, setEstado] = useState({ id: '', error: '' })
  useEffect(() => {
    let vigente = true
    async function comprobar() {
      try {
        if (etapa.estado === 'cerrada') {
          if (!archivo?.sesiones.some(s => s.id === id)) throw new Error('Esta sesión no pertenece a la etapa seleccionada.')
        } else {
          const { data, error } = await supabase.from('sesiones').select('id').eq('id', id).eq('etapa_id', etapa.id).single()
          if (error || !data) throw new Error('No se encontró esta sesión en la etapa seleccionada.')
        }
        if (vigente) setEstado({ id, error: '' })
      } catch (err) {
        if (vigente) setEstado({ id, error: err.message })
      }
    }
    void comprobar()
    return () => { vigente = false }
  }, [id, etapa.id, etapa.estado, archivo])
  if (estado.id !== id) return <Mensaje><p role="status">Verificando sesión…</p></Mensaje>
  if (estado.error) return <Mensaje><p role="alert">{estado.error}</p><Link to="/admin/dashboard">Volver a las sesiones</Link></Mensaje>
  return children
}
export default function RutaEtapa({ children, editar = false, sesion = false }) {
  const { id } = useParams()
  const { etapa, cargando, error, archivo, soloLectura } = useEtapa()
  if (cargando) return <Mensaje><p role="status">Cargando etapa…</p></Mensaje>
  if (error || !etapa) return <Navigate to="/admin/etapas" replace />
  if (editar && soloLectura) return <Mensaje><h1>Etapa cerrada</h1><p>El historial de {etapa.libro} está protegido. Puedes consultar sus resultados y preguntas.</p><Link to="/admin/dashboard">Consultar historial</Link></Mensaje>
  const contenido = <div key={`${etapa.id}-${etapa.estado}-${id || ""}`}>{children}</div>
  return sesion ? <ComprobarSesion key={etapa.id} etapa={etapa} archivo={archivo}>{contenido}</ComprobarSesion> : contenido
}
