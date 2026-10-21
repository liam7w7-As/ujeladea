export async function solicitarSugerencia(client, respuestaId) {
  const { data, error } = await client.functions.invoke('sugerir-calificacion', { body: { respuesta_id: respuestaId } })
  if (error) {
    let mensaje = 'No se pudo obtener la sugerencia. Puedes calificar manualmente.'
    try {
      const detalle = await error.context?.json()
      if (detalle?.error) mensaje = detalle.error
    } catch { /* Los errores de red pueden no incluir JSON. */ }
    throw new Error(mensaje)
  }
  return data
}
