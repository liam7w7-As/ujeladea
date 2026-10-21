export function combinarEstado(anterior, siguiente) {
  if (!siguiente || siguiente.version !== 2 || !siguiente.intento?.id) throw new Error('No se pudo leer el estado del examen.')
  if (!anterior || anterior.intento.id !== siguiente.intento.id) return siguiente
  if (anterior.intento.estado === 'finalizado' && siguiente.intento.estado !== 'finalizado') return anterior
  if (siguiente.intento.respondidas < anterior.intento.respondidas) return anterior
  if (siguiente.pregunta?.id === anterior.pregunta?.id && siguiente.pregunta && siguiente.pregunta.revision < anterior.pregunta.revision) return anterior
  if (Date.parse(siguiente.servidor_at) < Date.parse(anterior.servidor_at)) return anterior
  return siguiente
}
export function rutaIntento(sesion, estado) {
  return '/examen/' + sesion + (estado === 'finalizado' ? '/finalizado' : estado === 'en_curso' ? '/preguntas' : '/espera')
}
