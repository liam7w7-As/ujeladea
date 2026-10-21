export const DISTRIBUCION = { multiple: 27, abierta: 10, contexto: 8 }
export const PUNTOS = { multiple: 2, abierta: 3, contexto: 4 }
export const TIPOS = { multiple: 'Opción múltiple', abierta: 'Respuesta abierta', contexto: 'Contexto bíblico' }
export const esModeloNuevo = etapa => Number(etapa?.reglas?.version) >= 3
export const nota100 = (puntos, maximo) => maximo > 0 ? 100 * puntos / maximo : 0
export const formatoNota = valor => Number(valor || 0).toLocaleString('es-BO', { maximumFractionDigits: 2 })
