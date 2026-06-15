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
    const puntajesPorParticipante = {} // { participanteId: puntajeAcumulado }

    if (participantes.length > 0) {
      const pIds = participantes.map(p => p.id)
      const { data: respuestas, error: errResp } = await supabase
        .from('respuestas')
        .select('puntaje_obtenido, calificado_por, participante_id')
        .in('participante_id', pIds)
        
      if (errResp) throw errResp
      
      // Inicializar puntajes por participante
      pIds.forEach(pid => { puntajesPorParticipante[pid] = 0 })
      
      respuestas.forEach(r => {
        if (r.calificado_por === 'pendiente_ia') {
          pendientesIA++
        }
        const pts = r.puntaje_obtenido || 0
        puntajeObtenidoTotal += pts
        if (puntajesPorParticipante[r.participante_id] !== undefined) {
          puntajesPorParticipante[r.participante_id] += pts
        }
      })
    }

    // 4. Calcular promedio por participante
    const cantParticipantes = participantes.length || 1
    const promedioPorParticipante = Math.round((puntajeObtenidoTotal / cantParticipantes) * 10) / 10

    // 5. Obtener total de alertas de seguridad de la sesión
    let totalAlertas = 0
    const { data: alertasData, error: errAlertas } = await supabase
      .from('eventos_sesion')
      .select('id', { count: 'exact', head: true })
      .eq('sesion_id', sesionId)
    
    if (!errAlertas) {
      totalAlertas = alertasData?.length ?? 0
    }
    // Usar count si está disponible
    const { count: alertasCount } = await supabase
      .from('eventos_sesion')
      .select('*', { count: 'exact', head: true })
      .eq('sesion_id', sesionId)
    
    totalAlertas = alertasCount || 0

    // 6. Calcular penalización por alertas
    // 0-19 alertas: sin penalización
    // 20-29 alertas: -5%
    // 30-39 alertas: -10%
    // 40+ alertas: -15%
    let penalizacionPorcentaje = 0
    if (totalAlertas >= 40) penalizacionPorcentaje = 15
    else if (totalAlertas >= 30) penalizacionPorcentaje = 10
    else if (totalAlertas >= 20) penalizacionPorcentaje = 5

    const porcentajeBruto = Math.round((puntajeObtenidoTotal / puntajeMaximoTotal) * 100) || 0
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
      rindieron: participantes.length,
      totalCenso: censoOficial,
      rindieronCenso: participantes.filter(p => p.del_censo).length,
      invitados: participantes.filter(p => !p.del_censo).length,
      pendientesIA,
      promedioPorParticipante,
      totalAlertas,
      penalizacionPorcentaje
    }

  } catch (error) {
    console.error('Error calculando puntaje:', error)
    return null
  }
}
