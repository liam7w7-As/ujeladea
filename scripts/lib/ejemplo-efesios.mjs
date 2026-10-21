// Datos ficticios exclusivos para ensayos; no se cargan en Supabase ni en el banco.
export function ejemploEfesios({ cerrada = false, pendientes = true, sociedades = 2 } = {}) {
  const etapa = { id:'etapa-ejemplo',codigo:'2026-02-efesios',nombre:'Segunda etapa',libro:'Efesios',anio:2026,numero:2,estado:cerrada?'cerrada':'activa',historica:false,cantidad_preguntas:45,tiempo_limite:60 }
  const datos = Object.fromEntries(['sesiones','sociedades','participantes','preguntas','respuestas','eventos_sesion','intentos','intento_preguntas'].map(k=>[k,[]]))
  for (let s=0;s<sociedades;s++) {
    const sesion='sesion-'+s, soc='sociedad-'+s
    datos.sociedades.push({id:soc,nombre:'Sociedad juvenil de ejemplo '+(s+1),iglesia:'Iglesia ficticia para revisión del informe',total_censo:3})
    datos.sesiones.push({id:sesion,etapa_id:etapa.id,sociedad_id:soc,estado:'finalizado',created_at:'2026-10-21T12:00:00Z'})
    for (let p=0;p<2;p++) {
      const id='participante-'+s+'-'+p, intento='intento-'+s+'-'+p
      let total=0
      datos.intentos.push({id:intento,etapa_id:etapa.id,sesion_id:sesion,participante_id:id,estado:'finalizado',iniciado_at:'2026-10-21T12:00:00Z',finalizado_at:'2026-10-21T12:30:00Z'})
      for (let n=0;n<45;n++) {
        const q='asignada-'+s+'-'+p+'-'+n, pregunta='pregunta-'+n
        const snapshot={id:q,intento_id:intento,pregunta_id:pregunta,posicion:n+1,tipo:n===43?'abierta':'multiple',puntaje:10,texto:'Enunciado sintético de prueba',respuesta_correcta:'Referencia privada de prueba'}
        datos.intento_preguntas.push(snapshot)
        if (n===44) continue
        const pendiente = pendientes && s===0 && p===0 && n===43
        const puntos=pendiente?null:n%7===0?0:10
        total+=puntos||0
        datos.respuestas.push({id:'respuesta-'+q,participante_id:id,pregunta_id:pregunta,intento_id:intento,intento_pregunta_id:q,respuesta_dada:'Texto privado de ejemplo',puntaje_obtenido:puntos,calificado_por:pendiente?'pendiente_ia':'manual',created_at:'2026-10-21T12:20:00Z'})
      }
      datos.participantes.push({id,sesion_id:sesion,nombre:'Participante ficticio '+(s+1)+'-'+(p+1),del_censo:p===0,examen_finalizado:true,puntaje_total:total})
    }
    datos.participantes.push({id:'sin-registro-'+s,sesion_id:sesion,nombre:'Convocado ficticio sin registro',puntaje_total:0,del_censo:true})
    for (let e=0;e<(s===0?20:3);e++) datos.eventos_sesion.push({id:'evento-'+s+'-'+e,sesion_id:sesion,participante_id:'participante-'+s+'-0',tipo:'cambio_pestana'})
  }
  return {etapa,datos,emitidoAt:'2026-10-21T16:00:00Z'}
}
