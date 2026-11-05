import { useState } from 'react'
import { LifeBuoy } from 'lucide-react'
import Modal from './Modal'
import { apiExamen } from '../lib/participante-supabase'
import { horaExamen } from '../lib/experiencia-examen'

export default function AyudaExamen({ datos, aplicar }) {
  const [abierto, setAbierto] = useState(false)
  const [motivo, setMotivo] = useState('Problema con el dispositivo')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')
  const solicitud = datos.ayuda
  const pendiente = solicitud && !solicitud.atendida_at
  async function pedir() {
    if (ocupado) return
    setOcupado(true); setError('')
    try { aplicar(await apiExamen.ayuda(datos.intento.id, motivo)) }
    catch (e) { setError((e.message || 'No pudimos registrar tu solicitud.') + ' Levanta la mano y avisa al moderador sin cerrar el examen.') }
    finally { setOcupado(false) }
  }
  return <><button className="btn btn-secondary" onClick={() => setAbierto(true)}><LifeBuoy size={18} aria-hidden="true" />Necesito ayuda</button>
    <Modal isOpen={abierto} onClose={() => setAbierto(false)} titulo="Ayuda del moderador" mensaje="Conserva el examen abierto y levanta la mano. Pedir ayuda no descuenta puntos; el tiempo de la sala continúa." textoConfirmar="Volver a mi pregunta">
      {pendiente ? <p className="registro-confirmado" role="status">Solicitud registrada a las {horaExamen(solicitud.created_at)}. Esperando al moderador.</p> : <>
        {solicitud?.atendida_at && <p className="joven-ayuda">El moderador marcó tu solicitud anterior como atendida.</p>}
        <label className="form-label" htmlFor="motivo-ayuda">Qué necesitas</label><select id="motivo-ayuda" className="form-input" value={motivo} disabled={ocupado} onChange={e => setMotivo(e.target.value)}><option>Problema con el dispositivo</option><option>No puedo continuar</option><option>Necesito hablar con el moderador</option></select>
        <button className="btn btn-secondary" disabled={ocupado} onClick={pedir}>{ocupado ? 'Enviando solicitud…' : 'Avisar en el panel del moderador'}</button>
      </>}{error && <p role="alert" className="alert alert-warning">{error}</p>}
    </Modal>
  </>
}
