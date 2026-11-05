import { useState } from 'react'
import { CheckCircle2, ShieldCheck } from 'lucide-react'
import { apiExamen } from '../lib/participante-supabase'
import { horaExamen } from '../lib/experiencia-examen'

export default function AccesoPendiente({ datos, aplicar, errorConexion, recargar }) {
  const [motivo, setMotivo] = useState('')
  const [codigo, setCodigo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')
  const inicial = datos.intento.estado === 'registrado' && !datos.acceso.otra_pantalla
  const enviado = datos.acceso.solicitado
  async function pedir(recuperar = false) {
    if (ocupado) return
    setOcupado(true); setError('')
    try { aplicar(recuperar ? await apiExamen.recuperar(datos.sesion.id, codigo) : await apiExamen.contacto(datos.intento.id, 'solicitar', true, inicial ? 'Primer ingreso: verificar identidad' : motivo)) }
    catch (e) { setError(e.message) }
    finally { setOcupado(false) }
  }
  return <main className="page-wrapper"><section className="page-content card acceso-pendiente">
    <ShieldCheck size={36} aria-hidden="true" /><p className="eyebrow">{datos.etapa.libro} · {datos.sesion.sociedad}</p>
    <h1>{inicial ? 'Esperando autorización' : 'Volvamos a tu examen'}</h1>
    <p><strong>{datos.participante.nombre}</strong></p>
    <p className="joven-ayuda">{inicial ? 'Tu registro llegó. El moderador comprobará tu identidad antes de permitirte entrar.' : 'Tus respuestas confirmadas se conservan. El moderador debe autorizar esta pantalla para que continúes.'}</p>
    {!inicial && <p className="joven-acceso-progreso">{datos.intento.respondidas} respuestas confirmadas{datos.intento.total > 0 ? ' de ' + datos.intento.total : ''}. Retomarás la pregunta pendiente.</p>}
    <p className="joven-ayuda">{datos.sesion.estado === 'activo' ? 'El reloj de la sala sigue corriendo.' : 'El tiempo comenzará cuando el encargado inicie la evaluación.'}{horaExamen(datos.intento.vence_at || datos.sesion.vence_at) && ' Hora de cierre: ' + horaExamen(datos.intento.vence_at || datos.sesion.vence_at) + '.'}</p>
    {(error || errorConexion) && <div className="alert alert-warning" role="alert"><p>{error || 'No podemos actualizar la autorización. Conserva esta pantalla y avisa al moderador.'}</p>{recargar && <button className="btn btn-secondary" onClick={recargar}>Comprobar conexión</button>}</div>}
    {enviado && <div className="registro-confirmado" role="status"><CheckCircle2 size={18} aria-hidden="true" /> Solicitud recibida. Esperando al moderador.</div>}
    {!inicial && <><label className="form-label" htmlFor="motivo-acceso">Qué ocurrió (opcional)</label><input id="motivo-acceso" className="form-input" value={motivo} maxLength={500} onChange={e => setMotivo(e.target.value)} placeholder="Cierre accidental, cambio de dispositivo…" /></>}
    {(!inicial || !enviado) && <button className="btn btn-primary" disabled={ocupado} onClick={() => pedir()}>{ocupado ? 'Enviando…' : enviado ? 'Actualizar solicitud' : 'Solicitar autorización'}</button>}
    <p className="joven-ayuda">No necesitas recargar. Continuarás automáticamente cuando el moderador autorice este acceso. Si estás en la sala, levanta la mano para avisarle.</p>
    <details className="joven-recuperacion"><summary>Tengo un código o QR personal</summary><label className="form-label" htmlFor="codigo-acceso">Código de un solo uso</label><input id="codigo-acceso" className="form-input" autoComplete="off" value={codigo} maxLength={48} onChange={e => setCodigo(e.target.value)} /><button className="btn btn-secondary" disabled={ocupado || !codigo.trim()} onClick={() => pedir(true)}>Usar autorización</button></details>
  </section></main>
}
