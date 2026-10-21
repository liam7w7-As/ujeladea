import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createTestDatabase, applyMigrations, asRole, adminClaims } from '../scripts/lib/local-database.mjs'

async function fixture(cantidad = 3) {
  const db = await createTestDatabase()
  await applyMigrations(db)
  const usuarios = [randomUUID(), randomUUID(), randomUUID()]
  await db.query('INSERT INTO auth.users(id) SELECT unnest($1::uuid[])', [usuarios])
  const efesios = (await db.query("SELECT * FROM public.etapas WHERE libro='Efesios'")).rows[0]
  const sociedad = randomUUID()
  const sesion = randomUUID()
  const jovenes = [randomUUID(), randomUUID(), randomUUID()]
  await asRole(db, 'authenticated', adminClaims, async () => {
    await db.query('UPDATE public.etapas SET cantidad_preguntas=$1 WHERE id=$2', [cantidad, efesios.id])
    await db.query("INSERT INTO public.sociedades(id,nombre,iglesia) VALUES($1,'Sociedad ficticia','Prueba')", [sociedad])
    for (let k = 0; k < cantidad; k++) await db.query(
      "INSERT INTO public.preguntas(etapa_id,tipo,texto,opciones,respuesta_correcta,puntaje) VALUES($1,$2,$3,$4::jsonb,$5,$6)",
      [efesios.id, k === cantidad-1 ? 'abierta' : 'multiple', 'Pregunta sintética '+k, k === cantidad-1 ? null : JSON.stringify(['Correcta '+k,'Otra '+k]), k === cantidad-1 ? 'Referencia privada' : 'Correcta '+k, 10 + k],
    )
    await db.query("UPDATE public.etapas SET estado='activa' WHERE id=$1", [efesios.id])
    await db.query('INSERT INTO public.sesiones(id,etapa_id,sociedad_id) VALUES($1,$2,$3)', [sesion, efesios.id, sociedad])
    for (const id of jovenes) await db.query("INSERT INTO public.participantes(id,sesion_id,nombre,registrado_at) VALUES($1,$2,'Joven ficticio',NULL)", [id, sesion])
  })
  const rpc = (uid, nombre, args = []) => asRole(db, 'authenticated', { sub: uid, is_anonymous: true }, async () =>
    (await db.query('SELECT public.'+nombre+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') AS dato', args)).rows[0].dato)
  const admin = (nombre,args=[]) => asRole(db, 'authenticated', adminClaims, async () =>
    (await db.query('SELECT public.'+nombre+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') AS dato', args)).rows[0].dato)
  const registrar = (n=0) => rpc(usuarios[n], 'examen_registrar', [sesion,jovenes[n]])
  const iniciar = () => asRole(db,'authenticated',adminClaims,()=>db.query("UPDATE public.sesiones SET estado='activo',iniciado_at='2000-01-01' WHERE id=$1",[sesion]))
  const responder = async (estado, uid=usuarios[0], texto) => {
    const q = (await db.query('SELECT * FROM public.intento_preguntas WHERE id=$1',[estado.pregunta.id])).rows[0]
    return rpc(uid,'examen_responder',[estado.intento.id,q.id,texto ?? (q.tipo==='multiple' ? q.respuesta_correcta : 'Respuesta abierta del joven'), randomUUID()])
  }
  return { db, usuarios, jovenes, efesios, sesion, rpc, admin, registrar, iniciar, responder }
}

test('API de examen: identidad, orden persistente, recuperación y confirmación idempotente', async t => {
  const f=await fixture()
  const { db, usuarios, jovenes, sesion, rpc, admin }=f
  try {
    let registro
    await t.test('no hay RPC ni tablas disponibles sin autenticación', async () => {
      await asRole(db,'anon',{},async()=>{
        await assert.rejects(db.query('SELECT public.examen_sala($1)',[sesion]),{code:'42501'})
      })
      await asRole(db,'authenticated',{},async()=>{
        await assert.rejects(db.query('SELECT public.examen_sala($1)',[sesion]),{code:'42501'})
      })
    })
    await t.test('registra una vez y no permite apropiarse del nombre desde otro usuario',async()=>{
      registro=await f.registrar()
      const otra=await f.registrar()
      assert.equal(otra.intento.id,registro.intento.id)
      await assert.rejects(rpc(usuarios[1],'examen_registrar',[sesion,jovenes[0]]),{code:'23505'})
      await assert.rejects(rpc(usuarios[0],'examen_registrar',[sesion,jovenes[1]]),{code:'23505'})
      assert.equal((await db.query('SELECT count(*)::int n FROM public.intentos')).rows[0].n,1)
    })
    await t.test('no filtra claves, notas ni información de otro intento',async()=>{
      const sala=await rpc(usuarios[1],'examen_sala',[sesion])
      assert.equal(sala.participantes.length,2)
      assert.equal(sala.intento_id,null)
      await assert.rejects(rpc(usuarios[1],'examen_estado',[registro.intento.id]),{code:'42501'})
      await asRole(db,'authenticated',{sub:usuarios[0]},async()=>{
        for(const tabla of ['preguntas','respuestas','intentos','intento_preguntas']) assert.equal((await db.query('SELECT * FROM public.'+tabla)).rows.length,0)
        await assert.rejects(db.query("INSERT INTO public.respuestas(respuesta_dada) VALUES('x')"),{code:'42501'})
      })
    })
    let estado,orden
    await t.test('iniciar fija el tiempo en servidor y asigna todas las preguntas a los registrados',async()=>{
      await f.iniciar()
      estado=await rpc(usuarios[0],'examen_estado',[registro.intento.id])
      assert.equal(estado.intento.estado,'en_curso')
      assert.equal(estado.pregunta.posicion,1)
      assert.equal(estado.intento.total,3)
      assert.ok(new Date(estado.intento.vence_at).getFullYear()>2025)
      orden=(await db.query('SELECT id,pregunta_id,posicion FROM public.intento_preguntas ORDER BY posicion')).rows
      assert.equal(orden.length,3)
      const serialized=JSON.stringify(estado)
      for(const campo of ['respuesta_correcta','puntaje_obtenido','usuario_id','seed','referencia']) assert.equal(serialized.includes('"'+campo+'"'),false)
    })
    await t.test('editar el banco no cambia las preguntas ya asignadas',async()=>{
      const antes=estado.pregunta.texto
      const fuente=(await db.query('SELECT pregunta_id FROM public.intento_preguntas WHERE id=$1',[estado.pregunta.id])).rows[0].pregunta_id
      await asRole(db,'authenticated',adminClaims,()=>db.query("UPDATE public.preguntas SET texto='Editada después',puntaje=200 WHERE id=$1",[fuente]))
      estado=await rpc(usuarios[0],'examen_estado',[registro.intento.id])
      assert.equal(estado.pregunta.texto,antes)
      assert.ok(estado.pregunta.puntaje<200)
      assert.deepEqual((await db.query('SELECT id,pregunta_id,posicion FROM public.intento_preguntas ORDER BY posicion')).rows,orden)
    })
    await t.test('guarda borrador con versión y rechaza una escritura antigua de otra pestaña',async()=>{
      const texto=estado.pregunta.tipo==='multiple'?estado.pregunta.opciones[0]:'Borrador recuperable'
      estado=await rpc(usuarios[0],'examen_borrador',[estado.intento.id,estado.pregunta.id,texto,0])
      assert.equal(estado.pregunta.borrador,texto)
      assert.equal(estado.pregunta.revision,1)
      await assert.rejects(rpc(usuarios[0],'examen_borrador',[estado.intento.id,estado.pregunta.id,'Otra respuesta',0]),{code:'40001'})
      const recargado=await rpc(usuarios[0],'examen_estado',[estado.intento.id])
      assert.equal(recargado.pregunta.borrador,texto)
      assert.equal(recargado.pregunta.posicion,1)
    })
    await t.test('el doble envío y el reintento tras perder la confirmación generan una sola respuesta',async()=>{
      const qid=estado.pregunta.id
      const q=(await db.query('SELECT * FROM public.intento_preguntas WHERE id=$1',[qid])).rows[0]
      const texto=q.tipo==='multiple'?q.respuesta_correcta:'Respuesta abierta'
      const solicitud=randomUUID()
      const anterior=estado
      estado=await rpc(usuarios[0],'examen_responder',[estado.intento.id,qid,texto,solicitud])
      const repetido=await rpc(usuarios[0],'examen_responder',[estado.intento.id,qid,texto,solicitud])
      const otraId=await rpc(usuarios[0],'examen_responder',[estado.intento.id,qid,texto,randomUUID()])
      assert.equal(estado.pregunta.posicion,2)
      assert.equal(repetido.pregunta.id,estado.pregunta.id)
      assert.equal(otraId.pregunta.id,estado.pregunta.id)
      assert.equal((await db.query('SELECT count(*)::int n FROM public.respuestas')).rows[0].n,1)
      await assert.rejects(rpc(usuarios[0],'examen_responder',[anterior.intento.id,qid,'Texto cambiado',randomUUID()]),/ya fue confirmada/)
      const recargado=await rpc(usuarios[0],'examen_estado',[estado.intento.id])
      assert.equal(recargado.pregunta.posicion,2)
    })
    await t.test('no acepta preguntas futuras ni identificadores ajenos',async()=>{
      await assert.rejects(rpc(usuarios[0],'examen_responder',[estado.intento.id,orden[2].id,'Respuesta',randomUUID()]),{code:'42501'})
      await assert.rejects(rpc(usuarios[1],'examen_responder',[estado.intento.id,estado.pregunta.id,'Respuesta',randomUUID()]),{code:'42501'})
    })
    await t.test('traslada el intento con código del jurado, preserva orden y revoca acceso al dispositivo anterior',async()=>{
      await assert.rejects(rpc(usuarios[0],'admin_examen_recuperacion',[estado.intento.id]),{code:'42501'})
      const {codigo}=await admin('admin_examen_recuperacion',[estado.intento.id])
      assert.equal(codigo.length,32)
      const trasladado=await rpc(usuarios[2],'examen_recuperar',[sesion,codigo])
      assert.equal(trasladado.pregunta.id,estado.pregunta.id)
      assert.equal(trasladado.intento.vence_at,estado.intento.vence_at)
      await assert.rejects(rpc(usuarios[0],'examen_estado',[estado.intento.id]),{code:'42501'})
      await assert.rejects(rpc(usuarios[1],'examen_recuperar',[sesion,codigo]),{code:'42501'})
      estado=trasladado
    })
    await t.test('finaliza una sola vez y calificar dos veces no suma dos veces',async()=>{
      while(estado.pregunta) estado=await f.responder(estado,usuarios[2])
      assert.equal(estado.intento.estado,'finalizado')
      assert.equal(estado.intento.respondidas,3)
      assert.equal((await rpc(usuarios[2],'examen_finalizar',[estado.intento.id])).intento.estado,'finalizado')
      const abierta=(await db.query("SELECT r.id FROM public.respuestas r JOIN public.intento_preguntas q ON q.id=r.intento_pregunta_id WHERE q.tipo='abierta'")).rows[0]
      const contexto=await admin('admin_examen_contexto',[abierta.id])
      assert.equal(contexto.referencia,'Referencia privada')
      await assert.rejects(rpc(usuarios[2],'admin_examen_calificar',[abierta.id,10,'manual']),{code:'42501'})
      await assert.rejects(admin('admin_examen_calificar',[abierta.id,999,'manual']),/inválida/)
      await admin('admin_examen_calificar',[abierta.id,5,'manual'])
      const total1=(await db.query('SELECT puntaje_total FROM public.participantes WHERE id=$1',[jovenes[0]])).rows[0].puntaje_total
      await admin('admin_examen_calificar',[abierta.id,5,'manual'])
      assert.equal((await db.query('SELECT puntaje_total FROM public.participantes WHERE id=$1',[jovenes[0]])).rows[0].puntaje_total,total1)
      assert.equal(total1,(await db.query('SELECT sum(puntaje_obtenido)::int n FROM public.respuestas')).rows[0].n)
    })
    await t.test('el cierre archiva los snapshots y bloquea recalificaciones',async()=>{
      await asRole(db,'authenticated',adminClaims,()=>{
        return db.query("UPDATE public.sesiones SET estado='finalizado' WHERE id=$1",[sesion])
      })
      await asRole(db,'authenticated',adminClaims,()=>db.query("UPDATE public.etapas SET estado='cerrada' WHERE id=$1",[f.efesios.id]))
      const archivo=(await db.query('SELECT contenido FROM public.archivos_etapa WHERE etapa_id=$1',[f.efesios.id])).rows[0].contenido
      assert.equal(archivo.datos.intento_preguntas.length,3)
      assert.equal(archivo.datos.intentos.length,1)
      const r=archivo.datos.respuestas[0]
      await assert.rejects(admin('admin_examen_calificar',[r.id,0,'manual']),/cerrada/)
    })
  } finally { await db.close() }
})

test('vencimiento conserva el último borrador que llegó a tiempo y rechaza texto posterior',async()=>{
  const f=await fixture(1)
  try {
    let estado=await f.registrar()
    await f.iniciar()
    estado=await f.rpc(f.usuarios[0],'examen_estado',[estado.intento.id])
    await f.rpc(f.usuarios[0],'examen_borrador',[estado.intento.id,estado.pregunta.id,'Borrador escrito a tiempo',0])
    await f.db.query("UPDATE public.intentos SET vence_at=clock_timestamp()-interval '1 second' WHERE id=$1",[estado.intento.id])
    // Simular el borrador que ya existía antes de vencer, sin alterar el reloj global.
    await f.db.query("UPDATE public.intento_preguntas SET borrador_at=clock_timestamp()-interval '2 seconds' WHERE intento_id=$1",[estado.intento.id])
    const fin=await f.rpc(f.usuarios[0],'examen_responder',[estado.intento.id,estado.pregunta.id,'Texto fuera de plazo',randomUUID()])
    assert.equal(fin.intento.estado,'finalizado')
    assert.equal(fin.intento.motivo_cierre,'tiempo')
    assert.equal((await f.db.query('SELECT respuesta_dada FROM public.respuestas')).rows[0].respuesta_dada,'Borrador escrito a tiempo')
  } finally { await f.db.close() }
})

test('cierre forzado finaliza intentos y conserva borradores sin depender de una pestaña abierta',async()=>{
  const f=await fixture(1)
  try {
    let estado=await f.registrar()
    await f.iniciar()
    estado=await f.rpc(f.usuarios[0],'examen_estado',[estado.intento.id])
    await f.rpc(f.usuarios[0],'examen_borrador',[estado.intento.id,estado.pregunta.id,'Borrador antes del cierre',0])
    await asRole(f.db,'authenticated',adminClaims,()=>f.db.query("UPDATE public.sesiones SET estado='finalizado' WHERE id=$1",[f.sesion]))
    const fin=await f.rpc(f.usuarios[0],'examen_estado',[estado.intento.id])
    assert.equal(fin.intento.motivo_cierre,'cierre_sesion')
    assert.equal(fin.intento.respondidas,1)
  } finally { await f.db.close() }
})

test('eventos autenticados se deduplican y no aceptan identidades o tipos arbitrarios',async()=>{
  const f=await fixture(1)
  try{
    const registro=await f.registrar()
    await f.iniciar()
    const evento={id:randomUUID(),tipo:'cambio_pestana'}
    await f.rpc(f.usuarios[0],'examen_eventos',[registro.intento.id,JSON.stringify([evento])])
    await f.rpc(f.usuarios[0],'examen_eventos',[registro.intento.id,JSON.stringify([evento])])
    assert.equal((await f.db.query('SELECT count(*)::int n FROM public.eventos_sesion')).rows[0].n,1)
    await assert.rejects(f.rpc(f.usuarios[1],'examen_eventos',[registro.intento.id,JSON.stringify([evento])]),{code:'42501'})
    await assert.rejects(f.rpc(f.usuarios[0],'examen_eventos',[registro.intento.id,JSON.stringify([{id:randomUUID(),tipo:'inventado'}])]),/inválido/)
  }finally{await f.db.close()}
})
test('crear sesión es atómico y el cierre por tiempo ignora un reloj de navegador adelantado',async()=>{
  const f=await fixture(1)
  try{
    const sociedad=(await f.db.query('SELECT id FROM public.sociedades')).rows[0].id
    const antes=(await f.db.query('SELECT count(*)::int n FROM public.sesiones')).rows[0].n
    await assert.rejects(f.admin('admin_examen_crear_sesion',[f.efesios.id,sociedad,JSON.stringify([{nombre:'Válido',del_censo:true},{nombre:'',del_censo:true}])]),/Revisa/)
    assert.equal((await f.db.query('SELECT count(*)::int n FROM public.sesiones')).rows[0].n,antes)
    assert.equal((await f.db.query("SELECT count(*)::int n FROM public.participantes WHERE nombre='Válido'")).rows[0].n,0)
    await f.registrar()
    await f.iniciar()
    const cierre=await f.admin('admin_examen_cerrar_vencida',[f.sesion])
    assert.equal(cierre.cerrada,false)
    assert.equal((await f.db.query('SELECT estado FROM public.sesiones WHERE id=$1',[f.sesion])).rows[0].estado,'activo')
  }finally{await f.db.close()}
})
test('las RPC públicas no son SECURITY DEFINER y los ayudantes internos no se pueden invocar como participante',async()=>{
  const f=await fixture(1)
  try{
    const funciones=(await f.db.query("SELECT p.proname,p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname LIKE 'examen_%' OR p.proname LIKE 'admin_examen_%')")).rows
    assert.equal(funciones.length,14)
    assert.ok(funciones.every(p=>!p.prosecdef))
    await asRole(f.db,'authenticated',{sub:f.usuarios[0]},async()=>{
      for(const nombre of ['examen_uid()','examen_cerrar(uuid,text)','examen_iniciar(uuid)','examen_payload(uuid)','examen_bloquear(uuid)']){
        assert.equal((await f.db.query("SELECT has_function_privilege(current_user,$1,'EXECUTE') allowed",['app_private.'+nombre])).rows[0].allowed,false)
      }
      for(const tabla of ['intentos','intento_preguntas']){
        assert.equal((await f.db.query("SELECT has_table_privilege(current_user,$1,'UPDATE') allowed",['public.'+tabla])).rows[0].allowed,false)
      }
    })
  }finally{await f.db.close()}
})
test('cada nueva recuperación invalida el código anterior, y los códigos vencidos no cambian el propietario',async()=>{
  const f=await fixture(1)
  try{
    const registro=await f.registrar()
    const primero=await f.admin('admin_examen_recuperacion',[registro.intento.id])
    const segundo=await f.admin('admin_examen_recuperacion',[registro.intento.id])
    await assert.rejects(f.rpc(f.usuarios[1],'examen_recuperar',[f.sesion,primero.codigo]),{code:'42501'})
    await f.db.query("UPDATE app_private.codigos_reanudacion SET vence_at=clock_timestamp()-interval '1 second'")
    await assert.rejects(f.rpc(f.usuarios[1],'examen_recuperar',[f.sesion,segundo.codigo]),{code:'42501'})
    assert.equal((await f.db.query('SELECT usuario_id FROM public.intentos WHERE id=$1',[registro.intento.id])).rows[0].usuario_id,f.usuarios[0])
  }finally{await f.db.close()}
})

test('el panel solo permite al jurado leer su etapa y resume progreso y alertas sin descargar respuestas',async()=>{
  const f=await fixture(1)
  try{
    const registro=await f.registrar()
    await f.iniciar()
    const estado=await f.rpc(f.usuarios[0],'examen_estado',[registro.intento.id])
    await f.responder(estado)
    await asRole(f.db,'authenticated',adminClaims,()=>f.db.query(
      "INSERT INTO public.eventos_sesion(participante_id,sesion_id,tipo,cantidad) VALUES($1,$2,'cambio_pestana',2),($1,$2,'cambio_pestana',3)",[f.jovenes[0],f.sesion]))
    const sala=await f.admin('admin_examen_sala',[f.sesion,f.efesios.id])
    assert.equal(sala.participantes.length,3)
    assert.equal(sala.participantes.find(p=>p.id===f.jovenes[0]).respondidas,1)
    assert.equal(sala.participantes.find(p=>p.id===f.jovenes[0]).total,1)
    assert.equal(sala.alertas[0].total_eventos,2)
    assert.equal(sala.alertas[0].detalle.length,1)
    assert.equal(sala.alertas[0].detalle[0].cantidad,5)
    const texto=JSON.stringify(sala)
    for(const privado of ['respuesta_dada','respuesta_correcta','Referencia privada','Respuesta abierta del joven'])assert.equal(texto.includes(privado),false)
    await assert.rejects(f.rpc(f.usuarios[0],'admin_examen_sala',[f.sesion,f.efesios.id]),{code:'42501'})
    await assert.rejects(f.admin('admin_examen_sala',[f.sesion,randomUUID()]),{code:'42501'})
    await asRole(f.db,'anon',{},()=>assert.rejects(f.db.query('SELECT public.admin_examen_sala($1,$2)',[f.sesion,f.efesios.id]),{code:'42501'}))
    const tablas=(await f.db.query("SELECT tablename FROM pg_publication_tables WHERE pubname='supabase_realtime' ORDER BY tablename")).rows.map(r=>r.tablename)
    assert.deepEqual(tablas,['eventos_sesion','participantes','sesiones'])
  }finally{await f.db.close()}
})
