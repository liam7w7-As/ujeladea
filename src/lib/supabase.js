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

export async function obtenerDatosCompletosRanking() {
  try {
    // 1. Obtener todas las sesiones finalizadas
    const { data: sesiones, error: errSesiones } = await supabase
      .from('sesiones')
      .select('id, estado, created_at, sociedades(nombre, iglesia, total_censo)')
      .eq('estado', 'finalizado')

    if (errSesiones) throw errSesiones
    if (!sesiones || sesiones.length === 0) {
      return {
        rankingSociedades: [],
        rankingDisciplina: [],
        topJovenes: [],
        metricasGlobales: {
          totalSociedades: 0,
          totalJovenes: 0,
          promedioGeneralTorneo: 0,
          promedioPuntosTorneo: 0,
          mejorNota: null,
          mejorTiempo: null,
          sociedadMasDisciplinada: null,
          sociedadConMasAlertas: null,
          totalAlertasTorneo: 0
        }
      }
    }

    // 2. Calcular puntaje de cada sociedad
    const resultadosPromises = sesiones.map(s => calcularPuntajeSociedad(s.id))
    const resultados = await Promise.all(resultadosPromises)
    const sociedadesValidas = resultados.filter(Boolean)

    // Ordenar ranking oficial de sociedades:
    // Criterio 1: Efectividad Neta (%) DESC
    // Criterio 2: Promedio por participante DESC
    // Criterio 3: Menor cantidad de alertas ASC
    const rankingSociedades = [...sociedadesValidas].sort((a, b) => {
      if (b.porcentaje !== a.porcentaje) return b.porcentaje - a.porcentaje
      if (b.promedioPorParticipante !== a.promedioPorParticipante) return b.promedioPorParticipante - a.promedioPorParticipante
      return a.totalAlertas - b.totalAlertas
    })

    // Ranking de Disciplina (Juego Limpio):
    // Criterio 1: Menos alertas ASC
    // Criterio 2: Mayor efectividad DESC
    const rankingDisciplina = [...sociedadesValidas].sort((a, b) => {
      if (a.totalAlertas !== b.totalAlertas) return a.totalAlertas - b.totalAlertas
      return b.porcentaje - a.porcentaje
    })

    // 3. Obtener participantes para el Cuadro de Honor Individual
    const sesionIds = sesiones.map(s => s.id)
    const { data: dataParticipantes, error: errPart } = await supabase
      .from('participantes')
      .select('id, nombre, del_censo, registrado_at, examen_finalizado, puntaje_total, sesion_id, sesiones(id, created_at, sociedades(nombre, iglesia))')
      .in('sesion_id', sesionIds)
      .order('puntaje_total', { ascending: false })
      .limit(30)

    if (errPart) throw errPart

    const topPartIds = (dataParticipantes || []).map(p => p.id)

    // Cargar respuestas de los top participantes en bloques de 10
    let allRespuestas = []
    for (let i = 0; i < topPartIds.length; i += 10) {
      const chunk = topPartIds.slice(i, i + 10)
      const { data: respsChunk } = await supabase
        .from('respuestas')
        .select('participante_id, created_at, puntaje_obtenido, preguntas(puntaje)')
        .in('participante_id', chunk)
        .order('created_at', { ascending: true })
      if (respsChunk) allRespuestas.push(...respsChunk)
    }

    // Cargar alertas de los top participantes
    let alertasMap = {}
    if (topPartIds.length > 0) {
      const { data: dataAlertas } = await supabase
        .from('resumen_alertas')
        .select('participante_id, total_eventos')
        .in('participante_id', topPartIds)
      if (dataAlertas) {
        dataAlertas.forEach(a => { alertasMap[a.participante_id] = a.total_eventos })
      }
    }

    // Procesar métricas individuales de cada joven
    const jovenesEvaluados = (dataParticipantes || []).map(p => {
      const respsPart = allRespuestas.filter(r => r.participante_id === p.id)
      const puntajeMax = respsPart.reduce((acc, r) => acc + (r.preguntas?.puntaje || 0), 0)
      
      let duracionMs = 0
      let duracionTexto = 'N/D'
      if (respsPart.length > 0) {
        const t0 = new Date(respsPart[0].created_at).getTime()
        const t1 = new Date(respsPart[respsPart.length - 1].created_at).getTime()
        duracionMs = Math.max(0, t1 - t0)
        const min = Math.floor(duracionMs / 60000)
        const sec = Math.floor((duracionMs % 60000) / 1000)
        duracionTexto = `${min}m ${sec < 10 ? '0' : ''}${sec}s`
      }

      const efectividad = puntajeMax > 0 ? Math.min(100, Math.round((p.puntaje_total / puntajeMax) * 100)) : 0
      const alertas = alertasMap[p.id] || 0

      return {
        id: p.id,
        nombre: p.nombre,
        sociedad: p.sesiones?.sociedades?.nombre || 'Sociedad',
        iglesia: p.sesiones?.sociedades?.iglesia || '',
        puntaje: p.puntaje_total || 0,
        puntajeMax,
        efectividad,
        duracionMs,
        duracionTexto,
        alertas,
        del_censo: p.del_censo
      }
    })

    // Ordenar Top Jóvenes:
    // Criterio 1: Puntaje DESC
    // Criterio 2: Efectividad % DESC
    // Criterio 3: Menor tiempo ASC
    // Criterio 4: Menor alertas ASC
    jovenesEvaluados.sort((a, b) => {
      if (b.puntaje !== a.puntaje) return b.puntaje - a.puntaje
      if (b.efectividad !== a.efectividad) return b.efectividad - a.efectividad
      if (a.duracionMs > 0 && b.duracionMs > 0 && a.duracionMs !== b.duracionMs) return a.duracionMs - b.duracionMs
      return a.alertas - b.alertas
    })

    const topJovenes = jovenesEvaluados.slice(0, 10)

    // 4. Métricas ejecutivas globales
    const totalSociedades = rankingSociedades.length
    const totalJovenes = rankingSociedades.reduce((acc, s) => acc + (s.rindieron || 0), 0)
    const sumaPorcentajes = rankingSociedades.reduce((acc, s) => acc + (s.porcentaje || 0), 0)
    const promedioGeneralTorneo = totalSociedades > 0 ? Math.round((sumaPorcentajes / totalSociedades) * 10) / 10 : 0
    
    const sumaPromedios = rankingSociedades.reduce((acc, s) => acc + (s.promedioPorParticipante || 0), 0)
    const promedioPuntosTorneo = totalSociedades > 0 ? Math.round((sumaPromedios / totalSociedades) * 10) / 10 : 0

    const totalAlertasTorneo = rankingSociedades.reduce((acc, s) => acc + (s.totalAlertas || 0), 0)
    const mejorNota = topJovenes.length > 0 ? topJovenes[0] : null
    
    // Mejor tiempo: joven en el top con examen completado de al menos 2 minutos y efectividad >= 50%
    const candidatosTiempo = topJovenes.filter(j => j.duracionMs >= 120000 && j.efectividad >= 50)
    const mejorTiempo = candidatosTiempo.length > 0
      ? [...candidatosTiempo].sort((a, b) => a.duracionMs - b.duracionMs)[0]
      : (topJovenes.length > 0 ? topJovenes[0] : null)

    const sociedadMasDisciplinada = rankingDisciplina.length > 0 ? rankingDisciplina[0] : null
    const sociedadConMasAlertas = [...rankingSociedades].sort((a, b) => b.totalAlertas - a.totalAlertas)[0] || null

    const metricasGlobales = {
      totalSociedades,
      totalJovenes,
      promedioGeneralTorneo,
      promedioPuntosTorneo,
      mejorNota,
      mejorTiempo,
      sociedadMasDisciplinada,
      sociedadConMasAlertas,
      totalAlertasTorneo
    }

    return {
      rankingSociedades,
      rankingDisciplina,
      topJovenes,
      metricasGlobales
    }
  } catch (error) {
    console.error('Error al obtener datos completos del ranking:', error)
    throw error
  }
}


