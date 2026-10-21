import { Archive, BookOpen } from 'lucide-react'
import { useEtapa } from '../context/etapa-context'
import { etiquetaEtapa } from '../lib/etapas'

export default function EtapaAviso() {
  const { etapa, soloLectura } = useEtapa()
  if (!etapa) return null
  return <div className={`etapa-aviso ${soloLectura ? 'historica' : ''}`}>
    {soloLectura ? <Archive size={19} /> : <BookOpen size={19} />}
    <div><strong>{etiquetaEtapa(etapa)}</strong><p>{soloLectura
      ? 'Historial de solo lectura. Se conservan los datos y criterios de V1, incluidas sus respuestas repetidas.'
      : etapa.estado === 'borrador' ? 'Etapa en preparación. Completa su banco y configuración antes de activarla.' : 'Trabajando dentro de esta etapa.'}</p></div>
  </div>
}
