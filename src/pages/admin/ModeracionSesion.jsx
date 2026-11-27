import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { crearClienteModeracion } from '../../lib/supabase'
import SalaControl from './SalaControl'

export default function ModeracionSesion() {
  const { id } = useParams()
  return <IngresoModeracion key={id} id={id} />
}

function IngresoModeracion({ id }) {
  const [client] = useState(crearClienteModeracion)
  const [etapa, setEtapa] = useState(null)
  const [codigo, setCodigo] = useState(() => new URLSearchParams(location.hash.slice(1)).get('acceso'))
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')

  async function entrar() {
    if (ocupado) return
    setOcupado(true)
    setError('')
    try {
      const { data, error } = await client.auth.getSession()
      if (error) throw error
      if (!data.session && !codigo) throw new Error('Abre el enlace que te compartió la directiva.')
      if (!data.session) {
        const { error: errorIngreso } = await client.auth.signInAnonymously()
        if (errorIngreso) throw errorIngreso
      }
      const { data: etapa, error: errorAcceso } = await client.rpc('moderacion_entrar', { p_sesion: id, p_codigo: codigo })
      if (errorAcceso) throw errorAcceso
      globalThis.history.replaceState(globalThis.history.state, '', location.pathname)
      setCodigo(null)
      setEtapa(etapa)
    } catch (error) {
      setError(error.message)
    } finally {
      setOcupado(false)
    }
  }

  if (etapa) return <SalaControl id={id} etapa={etapa} client={client} moderacion />

  return <main className="page-wrapper"><section className="page-content card">
    <h1>Moderación de la sesión</h1>
    <p className="etapa-help">Abre la sala en el dispositivo que usarás para moderar.</p>
    {error && <p role="alert" className="alert alert-error">{error}</p>}
    <button className="btn btn-primary" disabled={ocupado} onClick={entrar}>{ocupado ? 'Comprobando acceso…' : 'Entrar a la sala'}</button>
  </section></main>
}
