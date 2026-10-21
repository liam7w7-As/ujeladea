import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { cargarArchivo, leerTodas, mensajeErrorEtapas } from '../lib/etapas'
import { EtapaContext } from './etapa-context'
import { useExamen } from './ExamenContext'

const SELECCION = 'ujeladea_etapa_admin_v2'
function leerSeleccion() {
  try { return sessionStorage.getItem(SELECCION) || '' } catch { return '' }
}
export default function EtapaProvider({ children }) {
  const { usuario } = useExamen()
  const [estado, setEstado] = useState({ etapas: [], archivo: null, cargando: true, error: '' })
  const [seleccion, setSeleccion] = useState(leerSeleccion)
  const [revision, setRevision] = useState(0)
  const claveCarga = [usuario?.user.id || '', seleccion, revision].join(':')
  useEffect(() => {
    let vigente = true
    let etapas = []
    async function cargar() {
      if (!usuario || usuario.tipo !== 'admin') return { etapas: [], archivo: null, cargando: false, error: '', clave: claveCarga }
      etapas = (await leerTodas(() => supabase.from('etapas').select('*')))
        .sort((a, b) => b.anio - a.anio || b.numero - a.numero)
      const etapa = etapas.find(e => e.id === seleccion)
      const archivo = etapa?.estado === 'cerrada' ? await cargarArchivo(supabase, etapa) : null
      return { etapas, archivo, cargando: false, error: '', clave: claveCarga }
    }
    cargar().then(resultado => { if (vigente) setEstado(resultado) }).catch(err => {
      if (vigente) setEstado({ etapas, archivo: null, cargando: false, error: mensajeErrorEtapas(err), clave: claveCarga })
    })
    return () => { vigente = false }
  }, [usuario, seleccion, revision, claveCarga])
  const recargar = useCallback(() => {
    setEstado(prev => ({ ...prev, cargando: true, error: '' }))
    setRevision(v => v + 1)
  }, [])
  const seleccionar = useCallback(id => {
    setEstado(prev => ({ ...prev, archivo: null, cargando: true, error: '' }))
    try { sessionStorage.setItem(SELECCION, id) } catch { /* La selección funciona sin almacenamiento. */ }
    setSeleccion(id)
    setRevision(v => v + 1)
  }, [])
  const etapa = estado.etapas.find(e => e.id === seleccion) || null
  const value = useMemo(() => ({ ...estado, cargando: estado.cargando || estado.clave !== claveCarga, etapa, soloLectura: etapa?.estado === 'cerrada', seleccionar, recargar }), [estado, etapa, seleccionar, recargar, claveCarga])
  return <EtapaContext.Provider value={value}>{children}</EtapaContext.Provider>
}
