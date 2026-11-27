import { useParams } from 'react-router-dom'
import { useEtapa } from '../../context/etapa-context'
import { supabase } from '../../lib/supabase'
import SalaControl from './SalaControl'

export default function SalaEspera() {
  const { id } = useParams()
  const { etapa } = useEtapa()
  return <SalaControl key={id} id={id} etapa={etapa} client={supabase} />
}
