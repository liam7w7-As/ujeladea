import { Navigate, useParams } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import useIntento from '../../hooks/useIntento'
import { rutaIntento } from '../../lib/estado-examen'
import EstadoParticipante from '../../components/EstadoParticipante'

export default function Finalizado() {
  const { sesionId } = useParams()
  const estado = useIntento(sesionId)
  if (estado.sinIntento) return <Navigate to={'/examen/' + sesionId} replace />
  if (!estado.datos) return <EstadoParticipante {...estado} />
  const { datos } = estado
  if (datos.intento.estado !== 'finalizado') return <Navigate to={rutaIntento(sesionId, datos.intento.estado)} replace />
  return <main className="page-wrapper"><section className="page-content card joven-finalizado">
    <CheckCircle2 size={56} /><p className="joven-libro">{datos.etapa.libro} · {datos.etapa.anio}</p><h1>Gracias por participar,<br />{datos.participante.nombre}</h1><p>{datos.sesion.sociedad}</p><h2>Tu examen ha finalizado</h2>
    <p className="joven-ayuda">El servidor confirmó {datos.intento.respondidas} de {datos.intento.total} respuestas. {datos.intento.motivo_cierre === 'tiempo' ? 'El tiempo de la sesión terminó.' : datos.intento.motivo_cierre === 'cierre_sesion' ? 'El encargado cerró la sesión.' : 'La entrega quedó registrada.'}</p>
    <p>La directiva comunicará los resultados después de la revisión.</p><p className="joven-versiculo">«Lámpara es a mis pies tu palabra.»<small>Salmos 119:105</small></p>
  </section></main>
}
