import { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { esAdmin } from '../lib/etapas'

const ExamenContext = createContext(null)
export function ExamenProvider({ children }) {
  const [usuario, setUsuario] = useState(null)
  const [sesionActiva, setSesionActiva] = useState(null)
  const [participanteActual, setParticipanteActual] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [errorAuth, setErrorAuth] = useState('')
  useEffect(() => {
    let vigente = true
    let recibidoEvento = false
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      recibidoEvento = true
      if (vigente) { setUsuario(esAdmin(session) ? { ...session, tipo: 'admin' } : null); setCargando(false) }
    })
    supabase.auth.getSession().then(({ data, error }) => {
      if (!vigente || recibidoEvento) return
      if (error) setErrorAuth('No se pudo comprobar tu sesión. Vuelve a iniciar sesión.')
      setUsuario(esAdmin(data?.session) ? { ...data.session, tipo: 'admin' } : null)
      setCargando(false)
    }).catch(() => {
      if (vigente) { setErrorAuth('No se pudo comprobar tu sesión. Vuelve a iniciar sesión.'); setCargando(false) }
    })
    return () => { vigente = false; subscription.unsubscribe() }
  }, [])
  const loginAdmin = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    if (!esAdmin(data.session)) {
      await supabase.auth.signOut()
      throw new Error('Esta cuenta no tiene el rol de administrador del torneo.')
    }
    setUsuario({ ...data.session, tipo: 'admin' })
    setErrorAuth('')
    return data
  }
  const logoutAdmin = async () => {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
    setUsuario(null)
    setSesionActiva(null)
  }
  return <ExamenContext.Provider value={{ usuario, sesionActiva, participanteActual, cargando, errorAuth, loginAdmin, logoutAdmin, setSesionActiva, setParticipanteActual }}>{children}</ExamenContext.Provider>
}
// Conserva la API de contexto de las pantallas existentes.
// eslint-disable-next-line react-refresh/only-export-components
export function useExamen() {
  const context = useContext(ExamenContext)
  if (!context) throw new Error('useExamen debe usarse dentro de un ExamenProvider')
  return context
}
