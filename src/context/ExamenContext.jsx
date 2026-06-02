import { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const ExamenContext = createContext(null)

export function ExamenProvider({ children }) {
  const [usuario, setUsuario] = useState(null) // null | { tipo: 'admin', ...session }
  const [sesionActiva, setSesionActiva] = useState(null)
  const [participanteActual, setParticipanteActual] = useState(null)
  const [cargando, setCargando] = useState(true)

  // Escuchar cambios de autenticación de Supabase
  useEffect(() => {
    // Obtener sesión actual al montar
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setUsuario({ tipo: 'admin', ...session })
      }
      setCargando(false)
    })

    // Suscribirse a cambios de auth
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (session) {
          setUsuario({ tipo: 'admin', ...session })
        } else {
          setUsuario(null)
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  const loginAdmin = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    if (error) throw error
    setUsuario({ tipo: 'admin', ...data.session })
    return data
  }

  const logoutAdmin = async () => {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
    setUsuario(null)
    setSesionActiva(null)
  }

  const value = {
    usuario,
    sesionActiva,
    participanteActual,
    cargando,
    loginAdmin,
    logoutAdmin,
    setSesionActiva,
    setParticipanteActual,
  }

  return (
    <ExamenContext.Provider value={value}>
      {children}
    </ExamenContext.Provider>
  )
}

export function useExamen() {
  const context = useContext(ExamenContext)
  if (!context) {
    throw new Error('useExamen debe usarse dentro de un ExamenProvider')
  }
  return context
}
