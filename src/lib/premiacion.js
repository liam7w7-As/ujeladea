import { rankingEtapa } from './etapas.js'

function posiciones(filas) {
  const elegibles = filas.filter(f => f.total !== null).sort((a,b) => b.total-a.total || a.nombre.localeCompare(b.nombre))
  let anterior = null, posicion = 0
  const posiciones = new Map()
  for (const [i,f] of elegibles.entries()) {
    if (anterior === null || Math.abs(f.total-anterior)>1e-9) posicion=i+1
    posiciones.set(f.id,posicion)
    anterior=f.total
  }
  return filas.map(f => ({...f,posicion:posiciones.get(f.id) ?? null})).sort((a,b) =>
    (a.posicion ?? Infinity)-(b.posicion ?? Infinity) || a.nombre.localeCompare(b.nombre))
}

// Hebreos ya llega con su resultado V1 congelado. No se recalifica ni se redondea otra vez.
export function calcularPremiacion(resumen, datos, etapa) {
  const ranking = rankingEtapa(datos)
  const anteriores = new Map()
  for (const h of resumen.hebreos.sociedades) {
    if (!anteriores.has(h.sociedadId)) anteriores.set(h.sociedadId,[])
    anteriores.get(h.sociedadId).push(h)
  }
  const actuales = new Map(ranking.rankingSociedades.map(s => [s.sociedadId,s]))
  const ids = new Set([...anteriores.keys(),...actuales.keys()])
  const sociedades = posiciones([...ids].map(id => {
    const fuentes = anteriores.get(id) || [], h=fuentes.length===1?fuentes[0]:null, e=actuales.get(id)
    const motivo = fuentes.length>1 ? 'Revisar varias sesiones históricas' : !h ? 'Sin resultado de Hebreos' :
      !e ? 'Sin resultado finalizado de Efesios' : h.pendientes || e.pendientesIA ? 'Hay calificaciones pendientes' : ''
    return {id,nombre:h?.sociedad || fuentes[0]?.sociedad || e?.sociedad || 'Sociedad',
      hebreos:h?.nota ?? null,efesios:e?.porcentaje ?? null,
      total:motivo?null:(h.nota+e.porcentaje)/2,motivo}
  }))
  const historicos = new Map(resumen.hebreos.participantes.map(p => [p.id,p]))
  const vinculos = new Map(resumen.vinculos.map(v => [v.efesios,v]))
  const notas = new Map((ranking.todosJovenes || []).map(p => [p.id,p]))
  const conPreguntas = new Set(datos.intento_preguntas.map(q => q.intento_id))
  const evaluados = new Set(datos.intentos.filter(i=>conPreguntas.has(i.id)).map(i=>i.participante_id))
  const individuales = posiciones(datos.participantes.filter(p=>evaluados.has(p.id)).map(p => {
    const v=vinculos.get(p.id),h=v?.hebreos?historicos.get(v.hebreos):null,e=notas.get(p.id)
    const motivo=!v?'Identidad entre etapas pendiente':!v.hebreos?'Participó solo en Efesios':
      !h?'Vinculación histórica inválida':!e?'Efesios todavía no finalizó':h.pendientes||e.pendientes?'Calificación pendiente':
        !h.puntajeMax?'Sin máximo histórico verificable':''
    return{id:p.id,nombre:p.nombre,sociedad:e?.sociedad || h?.sociedad || '',hebreos:h?.nota ?? null,
      efesios:e?.efectividad ?? null,total:motivo?null:(h.nota+e.efectividad)/2,motivo,vinculo:v || null}
  }))
  const pendientesIdentidad=individuales.filter(p=>!p.vinculo).length
  const avisos=[]
  if (!resumen.validacion_pdf) avisos.push('Falta contrastar Hebreos con el PDF de resultados original.')
  if (etapa.estado!=='cerrada' || ranking.provisional) avisos.push('Efesios sigue abierto o tiene resultados pendientes.')
  if (pendientesIdentidad) avisos.push(pendientesIdentidad+' identidades de Efesios requieren revisión.')
  if (sociedades.some(s=>s.motivo==='Revisar varias sesiones históricas' || s.motivo==='Hay calificaciones pendientes')) avisos.push('Hay resultados de sociedades que requieren revisión.')
  if (!sociedades.some(s=>s.total!==null)) avisos.push('Todavía no hay sociedades con resultados completos de ambas etapas.')
  return {sociedades,individuales,pendientesIdentidad,avisos,provisional:avisos.length>0}
}
