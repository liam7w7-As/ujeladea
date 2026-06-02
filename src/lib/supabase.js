import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    'Faltan variables de entorno: VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY. ' +
    'Crea un archivo .env en la raíz del proyecto con estas variables.'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export async function calcularPuntajeSociedad(sesionId) {
  try {
    // 1. Obtener la sesión con su sociedad
    const { data: sesion, error: errSesion } = await supabase
      .from('sesiones')
      .select('*, sociedades(nombre, iglesia, total_censo)')
      .eq('id', sesionId)
      .single()
    
    if (errSesion) throw errSesion
    
    // 2. Obtener los participantes de esta sesión
    const { data: participantes, error: errPart } = await supabase
      .from('participantes')
      .select('id, del_censo')
      .eq('sesion_id', sesionId)
      
    if (errPart) throw errPart
    
    const censoOficial = sesion.sociedades.total_censo || 1
    const maxPuntajePregunta = 10 // O el valor estándar (generalmente 10)
    const cantidadPreguntas = sesion.cantidad_preguntas || 15
    const maxPuntajePorParticipante = maxPuntajePregunta * cantidadPreguntas
    
    // El máximo posible de toda la sociedad se basa en TODO SU CENSO, no solo en los que asistieron
    const puntajeMaximoTotal = censoOficial * maxPuntajePorParticipante

    // 3. Obtener respuestas de estos participantes
    let puntajeObtenidoTotal = 0
    let pendientesIA = 0

    if (participantes.length > 0) {
      const pIds = participantes.map(p => p.id)
      const { data: respuestas, error: errResp } = await supabase
        .from('respuestas')
        .select('puntaje_obtenido, calificado_por, participante_id')
        .in('participante_id', pIds)
        
      if (errResp) throw errResp
      
      // Filtrar respuestas de participantes que no son del censo (invitados extra)
      // porque ellos no deberían sumar al puntaje de la sociedad, solo participan por participar.
      // O, según requerimiento: "los del_censo=false no afectan el denominador, pero rinden igual".
      // Normalmente sus puntos SÍ suman al numerador pero el denominador es fijo al total_censo.
      // Confirmemos requerimiento: "el denominador siempre es total_censo de la sociedad".
      // Sumaremos todos sus puntos por defecto, si la directiva decidió que jueguen.
      
      respuestas.forEach(r => {
        if (r.calificado_por === 'pendiente_ia') {
          pendientesIA++
        }
        // Asumiremos que los invitados suman puntos extras o normales a su iglesia. 
        // Si no deben sumar, haríamos: 
        // const p = participantes.find(x => x.id === r.participante_id); 
        // if(p.del_censo) puntajeObtenidoTotal += r.puntaje_obtenido || 0;
        // Pero lo más lógico es que todos los que rinden suman puntos.
        puntajeObtenidoTotal += (r.puntaje_obtenido || 0)
      })
    }

    const porcentaje = Math.round((puntajeObtenidoTotal / puntajeMaximoTotal) * 100) || 0

    return {
      sesionId,
      sociedad: sesion.sociedades.nombre,
      iglesia: sesion.sociedades.iglesia,
      fecha: sesion.created_at,
      porcentaje,
      puntajeObtenido: puntajeObtenidoTotal,
      puntajeMaximo: puntajeMaximoTotal,
      rindieron: participantes.length,
      totalCenso: censoOficial,
      pendientesIA
    }

  } catch (error) {
    console.error('Error calculando puntaje:', error)
    return null
  }
}
