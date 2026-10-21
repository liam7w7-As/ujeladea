export const ESTADOS_ETAPA = { borrador: 'En preparación', activa: 'Activa', cerrada: 'Cerrada' }

export function etiquetaEtapa(etapa) {
  return etapa ? `${etapa.nombre} · ${etapa.libro} · ${etapa.anio}` : 'Selecciona una etapa'
}

export function esAdmin(session) {
  return Boolean(session?.user?.id && session.user.app_metadata?.role === 'admin')
}

export function validarEtapa(form) {
  const payload = {
    nombre: form.nombre.trim(), libro: form.libro.trim(),
    anio: Number(form.anio), numero: Number(form.numero),
    tiempo_limite: Number(form.tiempo_limite), cantidad_preguntas: Number(form.cantidad_preguntas),
  }
  if (!payload.nombre || !payload.libro || payload.nombre.length > 80 || payload.libro.length > 80) {
    throw new Error('Escribe el nombre y el libro, con un máximo de 80 caracteres.')
  }
  for (const [campo, min, max] of [['anio', 2000, 9999], ['numero', 1, 100], ['tiempo_limite', 1, 240], ['cantidad_preguntas', 1, 200]]) {
    if (!Number.isInteger(payload[campo]) || payload[campo] < min || payload[campo] > max) {
      throw new Error(`Revisa ${campo.replaceAll('_', ' ')}: debe ser un entero entre ${min} y ${max}.`)
    }
  }
  return payload
}

export function codigoEtapa({ anio, numero, libro }) {
  const slug = libro.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `${anio}-${String(numero).padStart(2, '0')}-${slug || 'etapa'}`
}

export function mensajeErrorEtapas(error) {
  if (['42P01', '42703', '42883', 'PGRST205', 'PGRST204', 'PGRST202'].includes(error?.code)) {
    return 'La base conectada aún no tiene las etapas de V2. Completa la migración antes de usar este panel.'
  }
  if (error?.code === '23505') return 'Ya existe una etapa con ese número en el año, o hay otra etapa activa en ese año.'
  if (error?.code === '42501') return 'Tu cuenta no tiene permisos de administración. Revisa el rol y vuelve a iniciar sesión.'
  return error?.message || 'No se pudo completar la operación. Intenta de nuevo.'
}

// Todas las colecciones se paginan: PostgREST limita el número de filas por petición.
export async function leerTodas(crearConsulta, tamano = 500) {
  const filas = []
  for (let inicio = 0; ; inicio += tamano) {
    const { data, error } = await crearConsulta().order('id').range(inicio, inicio + tamano - 1)
    if (error) throw error
    if (!Array.isArray(data)) throw new Error('La base no devolvió una colección válida.')
    filas.push(...data)
    if (data.length < tamano) return filas
  }
}

async function porIds(client, tabla, campo, ids, columnas = "*") {
  const unicos = [...new Set(ids)]
  const filas = []
  for (let i = 0; i < unicos.length; i += 100) {
    filas.push(...await leerTodas(() => client.from(tabla).select(columnas).in(campo, unicos.slice(i, i + 100))))
  }
  return filas
}

export function datosArchivo(archivo, etapa) {
  if (archivo?.etapa_id !== etapa.id || archivo?.version_formato !== 1 || archivo?.contenido?.etapa?.id !== etapa.id) {
    throw new Error('El archivo histórico no corresponde a esta etapa o tiene un formato incompatible.')
  }
  const datos = archivo.contenido.datos
  if (!['sociedades', 'sesiones', 'participantes', 'preguntas', 'respuestas', 'eventos_sesion'].every(tabla => Array.isArray(datos?.[tabla]))) {
    throw new Error('El archivo histórico está incompleto. No se mostrarán datos actuales en su lugar.')
  }
  return datos
}

export async function cargarArchivo(client, etapa) {
  const { data, error } = await client.from('archivos_etapa').select('*').eq('etapa_id', etapa.id).single()
  if (error) throw error
  return datosArchivo(data, etapa)
}

async function cargarDatosAbiertos(client, etapa, { sesionId, modo='detalle' } = {}) {
  const consultasSesiones = () => {
    const q=client.from('sesiones').select('*').eq('etapa_id',etapa.id)
    return sesionId ? q.eq('id',sesionId) : q
  }
  const sesiones=await leerTodas(consultasSesiones)
  if(sesionId&&!sesiones.length)throw new Error('Esta sesión no pertenece a la etapa seleccionada.')
  // V2 consulta sus snapshots; no descarga todo el banco para calcular resultados.
  const preguntas=etapa.historica===false?[]:await leerTodas(()=>client.from('preguntas').select('*').eq('etapa_id',etapa.id))
  const ids=sesiones.map(s=>s.id)
  const [sociedades,participantes,eventos_sesion]=await Promise.all([
    porIds(client,'sociedades','id',sesiones.map(s=>s.sociedad_id)),
    porIds(client,'participantes','sesion_id',ids),
    porIds(client,'eventos_sesion','sesion_id',ids,modo==='detalle'?'*':'id,participante_id,sesion_id'),
  ])
  const columnas=modo==='detalle'?'*':'id,participante_id,pregunta_id,intento_id,intento_pregunta_id,puntaje_obtenido,calificado_por,created_at'
  const respuestas=await porIds(client,'respuestas','participante_id',participantes.map(p=>p.id),columnas)
  const datos={sesiones,preguntas,sociedades,participantes,respuestas,eventos_sesion}
  if(etapa.historica===false&&modo!=='sesiones') {
    datos.intentos=sesionId
      ? await porIds(client,'intentos','sesion_id',[sesionId])
      : await leerTodas(()=>client.from('intentos').select('*').eq('etapa_id',etapa.id))
    datos.intento_preguntas=await porIds(client,'intento_preguntas','intento_id',datos.intentos.map(i=>i.id),modo==='detalle'?'*':'id,intento_id,pregunta_id,puntaje,posicion')
  }
  return datos
}

export async function cargarDatosEtapa(client, etapa, archivo) {
  if(!etapa?.id)throw new Error('Selecciona una etapa antes de consultar resultados.')
  if(etapa.estado==='cerrada')return archivo||cargarArchivo(client,etapa)
  return cargarDatosAbiertos(client,etapa)
}

export async function cargarDatosSesion(client,etapa,sesionId,archivo) {
  if(!etapa?.id)throw new Error('Selecciona una etapa antes de consultar resultados.')
  if(etapa.estado==='cerrada') {
    const datos=archivo||await cargarArchivo(client,etapa)
    sesionConSociedad(datos,sesionId)
    return datos
  }
  return cargarDatosAbiertos(client,etapa,{sesionId})
}

export async function cargarResumenEtapa(client,etapa,archivo,modo='ranking') {
  if(!etapa?.id)throw new Error('Selecciona una etapa antes de consultar resultados.')
  if(etapa.estado==='cerrada')return archivo||cargarArchivo(client,etapa)
  return cargarDatosAbiertos(client,etapa,{modo})
}

export function sesionConSociedad(datos, id) {
  const sesion = datos.sesiones.find(s => s.id === id)
  if (!sesion) throw new Error('Esta sesión no pertenece a la etapa seleccionada.')
  return { ...sesion, sociedades: datos.sociedades.find(s => s.id === sesion.sociedad_id) }
}

function indiceDatos(datos) {
  const agrupar=(filas,campo)=>{
    const mapa=new Map()
    for(const fila of filas||[]) {
      if(!mapa.has(fila[campo]))mapa.set(fila[campo],[])
      mapa.get(fila[campo]).push(fila)
    }
    return mapa
  }
  return {
    preguntas:new Map(datos.preguntas.map(p=>[p.id,p])),
    asignadas:new Map((datos.intento_preguntas||[]).map(p=>[p.id,p])),
    respuestas:agrupar(datos.respuestas,'participante_id'),
    participantes:agrupar(datos.participantes,'sesion_id'),
    intentos:new Map((datos.intentos||[]).map(i=>[i.participante_id,i])),
    porIntento:agrupar(datos.intento_preguntas,'intento_id'),
    eventos:agrupar(datos.eventos_sesion,'participante_id'),
    eventosSesion:agrupar(datos.eventos_sesion,'sesion_id'),
  }
}

export function respuestasParticipante(datos, participanteId, indice = indiceDatos(datos)) {
  const { preguntas, asignadas } = indice
  return (indice.respuestas.get(participanteId) || [])
    .map(r => {
      const pregunta = r.intento_pregunta_id ? asignadas.get(r.intento_pregunta_id) : preguntas.get(r.pregunta_id)
      if (!pregunta) throw new Error('No se encontró la pregunta original de esta respuesta.')
      return { ...r, preguntas: pregunta }
    })
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at) || a.id.localeCompare(b.id))
}

export function participantesSesion(datos, id, indice = indiceDatos(datos)) {
  sesionConSociedad(datos, id)
  return (indice.participantes.get(id) || []).map(p => {
    const respuestas = respuestasParticipante(datos, p.id, indice)
    const intento = indice.intentos.get(p.id)
    const asignadas = (indice.porIntento.get(intento?.id) || [])
    return {
      ...p,
      intento,
      puntaje_max: Array.isArray(datos.intentos) ? asignadas.reduce((s,q) => s + q.puntaje, 0) : respuestas.reduce((s, r) => s + (r.preguntas?.puntaje || 0), 0),
      pendientes: respuestas.filter(r => r.calificado_por === 'pendiente_ia' || r.puntaje_obtenido === null).length,
      alertas: (indice.eventos.get(p.id) || []).length,
    }
  }).sort((a, b) => b.puntaje_total - a.puntaje_total || a.id.localeCompare(b.id))
}

// V1 conserva su cálculo original. V2 usa el máximo de todas las preguntas asignadas.
export function puntajeSesion(datos, id, indice = indiceDatos(datos)) {
  const sesion = sesionConSociedad(datos, id)
  const parts = participantesSesion(datos, id, indice).filter(p => !Array.isArray(datos.intentos) || p.intento)
  const respuestas = parts.flatMap(p => respuestasParticipante(datos, p.id))
  const puntajeObtenido = respuestas.reduce((s, r) => s + (r.puntaje_obtenido || 0), 0)
  const puntajeMaximo = parts.reduce((s,p) => s + p.puntaje_max, 0)
  const totalAlertas = (indice.eventosSesion.get(id) || []).length
  const penalizacionPorcentaje = totalAlertas >= 40 ? 15 : totalAlertas >= 30 ? 10 : totalAlertas >= 20 ? 5 : 0
  const porcentajeBruto = puntajeMaximo ? Math.round(puntajeObtenido / puntajeMaximo * 100) : 0
  return {
    sesionId: id, sociedad: sesion.sociedades?.nombre || 'Sociedad', iglesia: sesion.sociedades?.iglesia || '',
    fecha: sesion.created_at, porcentaje: Math.max(0, porcentajeBruto - penalizacionPorcentaje), porcentajeBruto,
    puntajeObtenido, puntajeMaximo, rindieron: parts.length, totalCenso: sesion.sociedades?.total_censo || null,
    rindieronCenso: parts.filter(p => p.del_censo).length, invitados: parts.filter(p => !p.del_censo).length,
    pendientesIA: parts.reduce((s, p) => s + p.pendientes, 0),
    promedioPorParticipante: parts.length ? Math.round(parts.reduce((s, p) => s + (p.puntaje_total || 0), 0) / parts.length * 10) / 10 : 0,
    totalAlertas, penalizacionPorcentaje,
  }
}

export function rankingEtapa(datos) {
  const indice = indiceDatos(datos)
  const sesiones = datos.sesiones.filter(s => s.estado === 'finalizado')
  const rankingSociedades = sesiones.map(s => puntajeSesion(datos, s.id, indice)).sort((a, b) =>
    b.porcentaje - a.porcentaje || b.promedioPorParticipante - a.promedioPorParticipante || a.totalAlertas - b.totalAlertas || a.sesionId.localeCompare(b.sesionId))
  const rankingDisciplina = [...rankingSociedades].sort((a, b) => a.totalAlertas - b.totalAlertas || b.porcentaje - a.porcentaje)
  const jovenes = sesiones.flatMap(s => participantesSesion(datos, s.id, indice).filter(p => !Array.isArray(datos.intentos) || p.intento).map(p => {
    const resps = respuestasParticipante(datos, p.id)
    const duracionMs = p.intento?.iniciado_at && p.intento?.finalizado_at ? Math.max(0, new Date(p.intento.finalizado_at) - new Date(p.intento.iniciado_at)) : resps.length ? Math.max(0, new Date(resps.at(-1).created_at) - new Date(resps[0].created_at)) : 0
    const sociedad = datos.sociedades.find(soc => soc.id === s.sociedad_id)
    return {
      id: p.id, nombre: p.nombre, sociedad: sociedad?.nombre || 'Sociedad', iglesia: sociedad?.iglesia || '',
      puntaje: p.puntaje_total || 0, puntajeMax: p.puntaje_max,
      efectividad: p.puntaje_max ? Math.min(100, Math.round((p.puntaje_total || 0) / p.puntaje_max * 100)) : 0,
      duracionMs, duracionTexto: resps.length ? `${Math.floor(duracionMs / 60000)}m ${String(Math.floor(duracionMs % 60000 / 1000)).padStart(2, '0')}s` : 'N/D',
      alertas: p.alertas, del_censo: p.del_censo,
    }
  }))
  // V1 seleccionaba primero 30 por puntaje antes de aplicar los desempates.
  const candidatos = Array.isArray(datos.intentos) ? jovenes : jovenes.sort((a, b) => b.puntaje - a.puntaje || a.id.localeCompare(b.id)).slice(0, 30)
  candidatos.sort((a, b) => b.puntaje - a.puntaje || b.efectividad - a.efectividad ||
    (a.duracionMs > 0 && b.duracionMs > 0 ? a.duracionMs - b.duracionMs : 0) || a.alertas - b.alertas || a.id.localeCompare(b.id))
  const topJovenes = candidatos.slice(0, 10)
  const tiempos = topJovenes.filter(j => j.duracionMs >= 120000 && j.efectividad >= 50).sort((a, b) => a.duracionMs - b.duracionMs)
  const promedio = campo => rankingSociedades.length ? Math.round(rankingSociedades.reduce((s, r) => s + r[campo], 0) / rankingSociedades.length * 10) / 10 : 0
  return { rankingSociedades, rankingDisciplina, topJovenes, metricasGlobales: {
    totalSociedades: rankingSociedades.length, totalJovenes: rankingSociedades.reduce((s, r) => s + r.rindieron, 0),
    promedioGeneralTorneo: promedio('porcentaje'), promedioPuntosTorneo: promedio('promedioPorParticipante'),
    mejorNota: topJovenes[0] || null, mejorTiempo: tiempos[0] || topJovenes[0] || null,
    sociedadMasDisciplinada: rankingDisciplina[0] || null,
    sociedadConMasAlertas: [...rankingSociedades].sort((a, b) => b.totalAlertas - a.totalAlertas)[0] || null,
    totalAlertasTorneo: rankingSociedades.reduce((s, r) => s + r.totalAlertas, 0),
  } }
}
