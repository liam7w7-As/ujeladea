import { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'
export default function Modal({isOpen,onClose,onConfirm,titulo,mensaje,tipo='info',textoConfirmar='Aceptar',textoCancelar='Cancelar',isConfirm=false,children}){
 const ref=useRef(null),tituloId=useId()
 useEffect(()=>{if(!isOpen||!ref.current)return;const d=ref.current;d.showModal();return()=>{if(d.open)d.close()}},[isOpen])
 if(!isOpen)return null
 return <dialog ref={ref} className={'modal-base '+tipo} aria-labelledby={tituloId} onCancel={e=>{e.preventDefault();onClose()}}><div className="card modal-contenido"><button className="btn btn-secondary cerrar-modal" aria-label="Cerrar diálogo" onClick={onClose}><X size={18}/></button><h2 id={tituloId}>{titulo}</h2>{mensaje&&<p className="etapa-help">{mensaje}</p>}{children}<div className="etapa-actions">{isConfirm&&<button className="btn btn-secondary" onClick={onClose}>{textoCancelar}</button>}<button className="btn btn-primary" onClick={()=>onConfirm?onConfirm():onClose()}>{textoConfirmar}</button></div></div></dialog>
}
