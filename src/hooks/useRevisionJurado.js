import { useEffect, useRef, useState } from 'react'
import { RevisionJurado, instanciaRevision } from '../lib/revision-jurado'
import { supabase } from '../lib/supabase'

let storage
try { storage = sessionStorage } catch { /* El servidor conserva borradores. */ }
const instancia = instanciaRevision(storage, performance.getEntriesByType('navigation')[0]?.type === 'reload')
export default function useRevisionJurado(sesion, etapa, actor) {
  const [estado, setEstado] = useState(null)
  const control = useRef(null)
  useEffect(() => {
    const revision = new RevisionJurado({ client: supabase, sesion, etapa, actor, instancia, storage, onState: setEstado })
    control.current = revision
    void revision.iniciar()
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void revision.pulso() }, 20000)
    const visible = () => { if (document.visibilityState === 'visible') void revision.pulso() }
    const cierre = () => revision.persistir()
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('pagehide', cierre)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', visible)
      window.removeEventListener('pagehide', cierre)
      revision.destruir()
      control.current = null
    }
  }, [sesion, etapa, actor])
  return { estado, control }
}
