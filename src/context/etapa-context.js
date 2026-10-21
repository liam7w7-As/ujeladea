import { createContext, useContext } from 'react'

export const EtapaContext = createContext(null)
export function useEtapa() {
  const context = useContext(EtapaContext)
  if (!context) throw new Error('useEtapa requiere EtapaProvider')
  return context
}
