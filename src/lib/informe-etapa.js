import { etiquetaEtapa, rankingEtapa } from './etapas.js'

// Proyección para informes de V2: no contiene enunciados, referencias ni respuestas.
export function prepararInformeEtapa({ etapa, datos, emitidoAt = new Date(), ejemplo = false }) {
  if (etapa?.historica !== false) throw new Error('Este informe requiere una etapa V2. Para Hebreos usa su informe histórico.')
  for (const tabla of ['sesiones','sociedades','participantes','preguntas','respuestas','eventos_sesion','intentos','intento_preguntas']) {
    if (!Array.isArray(datos?.[tabla])) throw new Error('Faltan datos para el informe: ' + tabla)
  }
  const sesiones = new Map(datos.sesiones.map(s => [s.id,s]))
  const participantes = new Map(datos.participantes.map(p => [p.id,p]))
  const intentos = new Map(datos.intentos.map(i => [i.id,i]))
  const asignadas = new Map(datos.intento_preguntas.map(q => [q.id,q]))
  if (datos.sesiones.some(s => s.etapa_id !== etapa.id)
      || datos.intentos.some(i => i.etapa_id !== etapa.id || !sesiones.has(i.sesion_id) || participantes.get(i.participante_id)?.sesion_id !== i.sesion_id)
      || datos.participantes.some(p => !sesiones.has(p.sesion_id))
      || datos.intento_preguntas.some(q => !intentos.has(q.intento_id))
      || datos.respuestas.some(r => intentos.get(r.intento_id)?.participante_id !== r.participante_id || asignadas.get(r.intento_pregunta_id)?.intento_id !== r.intento_id)) {
    throw new Error('Los datos del informe no corresponden íntegramente a esta etapa.')
  }
  const discrepancias = datos.participantes.filter(p => {
    const total = datos.respuestas.filter(r => r.participante_id === p.id).reduce((s,r) => s + (r.puntaje_obtenido || 0),0)
    return total !== (p.puntaje_total || 0)
  }).length
  const pendientes = datos.respuestas.filter(r => r.puntaje_obtenido === null || r.calificado_por === 'pendiente_ia').length
  const abiertas = datos.sesiones.filter(s => s.estado !== 'finalizado').length
  const motivos = [
    etapa.estado !== 'cerrada' && 'La etapa todavía no está cerrada.',
    abiertas > 0 && abiertas + ' sesiones siguen abiertas.',
    pendientes > 0 && pendientes + (pendientes === 1 ? ' respuesta necesita calificación.' : ' respuestas necesitan calificación.'),
    discrepancias > 0 && discrepancias + (discrepancias === 1 ? ' total guardado requiere revisión.' : ' totales guardados requieren revisión.'),
    ejemplo && 'Datos sintéticos de ejemplo; no representan resultados del torneo.',
  ].filter(Boolean)
  const ranking = rankingEtapa(datos)
  const idsFinalizados = new Set(datos.sesiones.filter(s => s.estado === 'finalizado').map(s => s.id))
  const registrosFinalizados = datos.intentos.filter(i => idsFinalizados.has(i.sesion_id)).length
  return {
    etapa: { nombre: etapa.nombre, libro: etapa.libro, anio: etapa.anio, codigo: etapa.codigo, estado: etapa.estado, tiempo_limite: etapa.tiempo_limite, cantidad_preguntas: etapa.cantidad_preguntas },
    etiqueta: etiquetaEtapa(etapa),
    emitidoAt: new Date(emitidoAt).toISOString(),
    provisional: motivos.length > 0, motivos, ejemplo,
    resumen: {
      sesiones: datos.sesiones.length, finalizadas: datos.sesiones.length - abiertas, abiertas,
      convocados: datos.participantes.length, registrados: datos.intentos.length,
      sinRegistro: datos.participantes.filter(p => !datos.intentos.some(i => i.participante_id === p.id)).length,
      enCurso: datos.intentos.filter(i => i.estado === 'en_curso').length,
      terminados: datos.intentos.filter(i => i.estado === 'finalizado').length,
      asignadas: datos.intento_preguntas.length, respondidas: datos.respuestas.length,
      sinResponder: Math.max(0,datos.intento_preguntas.length - datos.respuestas.length),
      pendientes, discrepancias, registrosFinalizados,
    },
    sociedades: ranking.rankingSociedades.map(s => ({
      sesionId: s.sesionId, posicion:s.posicion, sociedad: s.sociedad, iglesia: s.iglesia,
      rindieron: s.rindieron, puntajeObtenido: s.puntajeObtenido, puntajeMaximo: s.puntajeMaximo,
      porcentajeBruto: s.porcentajeBruto, porcentaje: s.porcentaje, penalizacionPorcentaje: s.penalizacionPorcentaje,
      totalAlertas: s.totalAlertas, pendientes: s.pendientesIA,
    })),
    jovenes: ranking.topJovenes.map(j => ({
      posicion:j.posicion, nombre: j.nombre, sociedad: j.sociedad, puntaje: j.puntaje, maximo: j.puntajeMax,
      efectividad: j.efectividad, duracion: j.duracionTexto,
      pendientes: datos.respuestas.filter(r => r.participante_id === j.id && (r.puntaje_obtenido === null || r.calificado_por === 'pendiente_ia')).length,
    })),
    metodologia: [
      'Una fila por sociedad, consolidando todas sus sesiones finalizadas. Solo se incluyen intentos con preguntas asignadas; los abandonos conservan su resultado.',
      'Nota individual: 100 por puntos obtenidos dividido entre el máximo de todas las preguntas asignadas, también las no respondidas. Los snapshots conservan los valores y rúbricas originales.',
      'Nota de sociedad: promedio de las notas individuales, con el mismo peso por joven. Se conserva precisión para ordenar y se muestran dos decimales.',
      'No se usa censo ni penalización automática por alertas. Las señales del navegador requieren revisión del moderador.',
      'Opción múltiple: corrección automática. Respuestas abiertas y de contexto: criterios de la rúbrica y revisión del jurado. La IA solo sugiere.',
      'Los empates comparten posición. La velocidad, los eventos técnicos y el tamaño de la sociedad no otorgan ventajas ni descuentos.',
      'Las posiciones siguen siendo provisionales mientras la etapa esté abierta, haya notas pendientes o existan diferencias en los totales.',
    ],
  }
}
