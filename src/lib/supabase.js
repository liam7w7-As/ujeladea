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
      .select('id, del_censo, puntaje_total')
      .eq('sesion_id', sesionId)
      
    if (errPart) throw errPart
    
    const censoOficial = sesion.sociedades.total_censo || null
    const cantParticipantes = participantes.length

    // 3. Obtener todas las respuestas con el puntaje real de cada pregunta
    //    Esto nos da el puntaje máximo REAL (basado en las preguntas que les tocaron)
    //    y el puntaje obtenido REAL.
    let puntajeObtenidoTotal = 0
    let puntajeMaximoTotal = 0
    let pendientesIA = 0

    if (cantParticipantes > 0) {
      const pIds = participantes.map(p => p.id)

      const { data: respuestas, error: errResp } = await supabase
        .from('respuestas')
        .select('puntaje_obtenido, calificado_por, participante_id, preguntas(puntaje)')
        .in('participante_id', pIds)
        
      if (errResp) throw errResp
      
      respuestas.forEach(r => {
        if (r.calificado_por === 'pendiente_ia') {
          pendientesIA++
        }
        // Sumar puntaje obtenido real
        puntajeObtenidoTotal += (r.puntaje_obtenido || 0)
        // Sumar puntaje máximo real (lo que valía esa pregunta)
        puntajeMaximoTotal += (r.preguntas?.puntaje || 0)
      })
    }

    // 4. Promedio de puntaje individual: promedio de puntaje_total de cada participante
    //    (campo que ya tiene el puntaje final acumulado de cada joven)
    const promedioPorParticipante = cantParticipantes > 0
      ? Math.round((participantes.reduce((sum, p) => sum + (p.puntaje_total || 0), 0) / cantParticipantes) * 10) / 10
      : 0

    // 5. Obtener total de alertas de seguridad de la sesión
    const { count: totalAlertas } = await supabase
      .from('eventos_sesion')
      .select('*', { count: 'exact', head: true })
      .eq('sesion_id', sesionId)

    // 6. Calcular penalización por alertas
    // 0-19 alertas: sin penalización
    // 20-29 alertas: -5%
    // 30-39 alertas: -10%
    // 40+ alertas: -15%
    let penalizacionPorcentaje = 0
    const alertasTotal = totalAlertas || 0
    if (alertasTotal >= 40) penalizacionPorcentaje = 15
    else if (alertasTotal >= 30) penalizacionPorcentaje = 10
    else if (alertasTotal >= 20) penalizacionPorcentaje = 5

    // 7. Porcentaje basado en participantes reales (no en el censo)
    const porcentajeBruto = puntajeMaximoTotal > 0
      ? Math.round((puntajeObtenidoTotal / puntajeMaximoTotal) * 100)
      : 0
    const porcentaje = Math.max(0, porcentajeBruto - penalizacionPorcentaje)

    return {
      sesionId,
      sociedad: sesion.sociedades.nombre,
      iglesia: sesion.sociedades.iglesia,
      fecha: sesion.created_at,
      porcentaje,
      porcentajeBruto,
      puntajeObtenido: puntajeObtenidoTotal,
      puntajeMaximo: puntajeMaximoTotal,
      rindieron: cantParticipantes,
      totalCenso: censoOficial,                                           // solo informativo
      rindieronCenso: participantes.filter(p => p.del_censo).length,
      invitados: participantes.filter(p => !p.del_censo).length,
      pendientesIA,
      promedioPorParticipante,
      totalAlertas: alertasTotal,
      penalizacionPorcentaje
    }

  } catch (error) {
    console.error('Error calculando puntaje:', error)
    return null
  }
}

