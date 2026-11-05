// Solo separa un pasaje si el autor lo delimitó expresamente. Nunca adivina ni omite texto.
export function separarContexto(texto, tipo) {
  if (tipo === 'contexto') {
    const partes = texto.match(/^\s*(?:Pasaje|Contexto|Lectura)(?: bíblico)?\s*:\s*([\s\S]+?)\n\s*(?:Pregunta|Consigna)\s*:\s*([\s\S]+)$/i)
    if (partes?.[1].trim() && partes[2].trim()) return { contexto: partes[1].trim(), consigna: partes[2].trim() }
  }
  return { contexto: '', consigna: texto }
}

export const buscarNombre = texto => texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim()
export const horaExamen = fecha => fecha && Number.isFinite(Date.parse(fecha))
  ? new Date(fecha).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/La_Paz' }) : ''

export function estadoGuardado({ estado, texto, localDisponible }) {
  const copia = localDisponible ? 'Tu borrador está en este dispositivo.' : 'La copia local no está disponible. Conserva esta pantalla abierta.'
  if (estado === 'guardado') return texto.trim()
    ? { titulo: 'Borrador sincronizado', detalle: 'Recibido por el servidor. Falta confirmar para avanzar.', tono: 'correcto' }
    : { titulo: 'Aún sin respuesta', detalle: 'Responde y revisa antes de confirmar.', tono: 'neutro' }
  return ({
    local: { titulo: localDisponible ? 'Guardado en este dispositivo' : 'Sin copia local', detalle: copia + ' Esperando sincronización.', tono: 'aviso' },
    guardando: { titulo: 'Sincronizando borrador…', detalle: copia, tono: 'neutro' },
    error: { titulo: 'Falta sincronizar con el servidor', detalle: copia + ' Reintenta al recuperar la conexión.', tono: 'aviso' },
    pendiente: { titulo: 'Confirmación pendiente', detalle: 'Aún no recibimos el comprobante. Reintentaremos el mismo envío al conectar. ' + copia, tono: 'aviso' },
    enviando: { titulo: 'Confirmando respuesta…', detalle: 'Espera la respuesta del servidor para avanzar.', tono: 'neutro' },
    conflicto: { titulo: 'Hay dos versiones de tu borrador', detalle: 'Elige qué texto conservar antes de continuar. Ninguna versión se sustituirá sin tu decisión.', tono: 'aviso' },
  })[estado] || { titulo: 'Comprobando guardado…', detalle: 'Mantén esta pantalla abierta.', tono: 'neutro' }
}
