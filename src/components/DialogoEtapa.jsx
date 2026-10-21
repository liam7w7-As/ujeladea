import { useEffect, useRef } from 'react'

export default function DialogoEtapa({ children, onClose, bloqueado }) {
  const ref = useRef(null)
  useEffect(() => {
    const dialogo = ref.current
    dialogo.showModal()
    return () => { if (dialogo.open) dialogo.close() }
  }, [])
  return <dialog ref={ref} className="card etapa-modal" aria-labelledby="confirmar-etapa-titulo" onCancel={e => { e.preventDefault(); if (!bloqueado) onClose() }}>{children}</dialog>
}
