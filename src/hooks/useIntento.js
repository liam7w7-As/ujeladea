import { useCallback, useEffect, useRef, useState } from 'react'
import { apiExamen } from '../lib/participante-supabase'
import { combinarEstado } from '../lib/estado-examen'

export default function useIntento(sesionId) {
  const [estado, setEstado] = useState({ datos: null, error: '', sinIntento: false, cargando: true, sesionId })
  const vigente = useRef(false)
  const intento = useRef(null)
  const terminado = useRef(false)
  const solicitar = useRef(null)
  const aplicar = useCallback(datos => {
    if (vigente.current !== sesionId) return
    intento.current = datos.intento.id
    terminado.current ||= datos.intento.estado === 'finalizado'
    setEstado(prev => ({ datos: combinarEstado(prev.datos, datos), error: '', sinIntento: false, cargando: false, sesionId }))
  }, [sesionId])
  useEffect(() => {
    vigente.current = sesionId
    let cancelado = false
    let ocupado = false
    async function cargar() {
      if (ocupado || terminado.current) return
      ocupado = true
      try {
        if (!intento.current) {
          const sala = await apiExamen.sala(sesionId)
          if (cancelado) return
          if (!sala.intento_id) { setEstado({ datos: null, error: '', sinIntento: true, cargando: false, sesionId }); return }
          intento.current = sala.intento_id
        }
        const datos = await apiExamen.estado(intento.current)
        if (!cancelado) aplicar(datos)
      } catch (err) {
        if (!cancelado) setEstado(prev => ({ ...prev, datos: err.code === '42501' ? null : prev.datos, error: err.message, cargando: false, sesionId }))
      } finally { ocupado = false }
    }
    solicitar.current = cargar
    void cargar()
    const timer = setInterval(cargar, 5000)
    const visible = () => { if (document.visibilityState === 'visible') void cargar() }
    window.addEventListener('online', cargar)
    document.addEventListener('visibilitychange', visible)
    return () => {
      vigente.current = null
      cancelado = true
      clearInterval(timer)
      window.removeEventListener('online', cargar)
      document.removeEventListener('visibilitychange', visible)
      solicitar.current = null
      intento.current = null
      terminado.current = false
    }
  }, [sesionId, aplicar])
  const recargar = useCallback(() => solicitar.current?.(), [])
  return estado.sesionId === sesionId ? { ...estado, aplicar, recargar } : { datos: null, error: '', sinIntento: false, cargando: true, aplicar, recargar }
}
