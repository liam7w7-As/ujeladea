import { Navigate, useParams } from 'react-router-dom'
import useIntento from '../../hooks/useIntento'
import EstadoParticipante from '../../components/EstadoParticipante'
import AccesoPendiente from '../../components/AccesoPendiente'
import InstruccionesExamen from '../../components/InstruccionesExamen'
import { rutaIntento } from '../../lib/estado-examen'

export default function Espera() {
  const { sesionId } = useParams()
  const estado = useIntento(sesionId)
  if (estado.sinIntento) return <Navigate to={'/examen/' + sesionId} replace />
  if (!estado.datos) return <EstadoParticipante {...estado} />
  const { datos } = estado
  if (datos.intento.estado !== 'registrado') return <Navigate to={rutaIntento(sesionId, datos.intento.estado)} replace />
  if (datos.acceso?.pendiente) return <AccesoPendiente datos={datos} aplicar={estado.aplicar} />
  return <main className="page-wrapper"><section className="page-content card joven-espera">
    <img src="/logo.png" alt="UJELADEA" className="joven-logo" /><p className="joven-libro">{datos.etapa.libro} · {datos.etapa.anio}</p><h1>Hola, {datos.participante.nombre}</h1><p>{datos.sesion.sociedad}</p><div className="registro-confirmado">Registro confirmado</div><h2>Esperando al encargado</h2><p className="joven-ayuda">Mantén esta pantalla abierta. Entrarás cuando el encargado inicie la sesión.</p><p className="joven-versiculo">«Lámpara es a mis pies tu palabra, y lumbrera a mi camino.»<small>Salmos 119:105</small></p>
    <InstruccionesExamen total={datos.intento.total} />
    {estado.error && <div className="alert alert-warning" role="status">Estamos intentando reconectar. Tu registro se conserva.<button className="btn btn-secondary" onClick={estado.recargar}>Reintentar</button></div>}
  </section></main>
}
