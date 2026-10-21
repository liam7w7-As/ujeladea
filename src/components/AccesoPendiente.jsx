import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { apiExamen } from '../lib/participante-supabase'
export default function AccesoPendiente({ datos, aplicar }) {
 const [motivo,setMotivo]=useState(''),[codigo,setCodigo]=useState(''),[ocupado,setOcupado]=useState(false),[error,setError]=useState('')
 async function pedir(recuperar=false){setOcupado(true);setError('');try{aplicar(recuperar?await apiExamen.recuperar(datos.sesion.id,codigo):await apiExamen.contacto(datos.intento.id,'solicitar',true,motivo))}catch(e){setError(e.message)}finally{setOcupado(false)}}
 return <main className="page-wrapper"><section className="page-content card acceso-pendiente"><ShieldCheck size={36}/><p className="eyebrow">{datos.etapa.libro}</p><h1>El moderador autoriza tu acceso</h1><p>{datos.participante.nombre}, tus respuestas y tu avance se conservan.</p><p className="joven-ayuda">{datos.acceso.motivo}. {datos.sesion.estado==='activo'?'El tiempo de la sala sigue corriendo.':'El tiempo comenzará cuando el encargado inicie la evaluación.'}{datos.intento.vence_at ? ' Cierra a las '+new Date(datos.intento.vence_at).toLocaleTimeString('es-BO')+'.' : ''}</p>
 {error&&<p className="alert alert-error" role="alert">{error}</p>}
 <label className="form-label" htmlFor="motivo-acceso">Cuéntale al moderador qué ocurrió</label><input id="motivo-acceso" className="form-input" value={motivo} maxLength={500} onChange={e=>setMotivo(e.target.value)} placeholder="Primer ingreso, cierre accidental, cambio de dispositivo…"/>
 <button className="btn btn-primary" disabled={ocupado} onClick={()=>pedir()}>{ocupado?'Enviando…':datos.acceso.solicitado?'Actualizar solicitud':'Solicitar autorización'}</button><p role="status" className="joven-ayuda">La pantalla continuará automáticamente cuando el moderador autorice este acceso.</p>
 <details><summary>Tengo un código o QR personal</summary><label className="form-label" htmlFor="codigo-acceso">Código de un solo uso</label><input id="codigo-acceso" className="form-input" value={codigo} maxLength={48} onChange={e=>setCodigo(e.target.value)}/><button className="btn btn-secondary" disabled={ocupado||!codigo.trim()} onClick={()=>pedir(true)}>Usar autorización</button></details>
 </section></main>
}
