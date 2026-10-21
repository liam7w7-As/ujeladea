import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createTestDatabase, applyMigrations, asRole, adminClaims } from '../scripts/lib/local-database.mjs'
import { rankingEtapa } from '../src/lib/etapas.js'
async function fixture(){
 const db=await createTestDatabase();await applyMigrations(db)
 const users=[randomUUID(),randomUUID(),randomUUID()],instancias=users.map(()=>randomUUID())
 await db.query('INSERT INTO auth.users(id) SELECT unnest($1::uuid[])',[users])
 const e=(await db.query("SELECT * FROM public.etapas WHERE libro='Efesios'")).rows[0]
 const sociedad=(await db.query("INSERT INTO public.sociedades(nombre,iglesia) VALUES('Sociedad V3','Pruebas') RETURNING id")).rows[0].id
 for(const [tipo,n,puntos] of [['multiple',33,2],['abierta',12,3],['contexto',10,4]])for(let k=0;k<n;k++)await db.query("INSERT INTO public.preguntas(etapa_id,tipo,texto,opciones,respuesta_correcta,puntaje,rubrica) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7::jsonb)",[e.id,tipo,tipo+' '+k,tipo==='multiple'?JSON.stringify(['Correcta','Alternativa']):null,'Correcta',puntos,JSON.stringify(tipo==='multiple'?[]:[{criterio:'Explicación esperada',puntos}])])
 await asRole(db,'authenticated',adminClaims,()=>db.query("UPDATE public.etapas SET estado='activa' WHERE id=$1",[e.id]))
 async function rpc(uid,name,args=[],inst=instancias[users.indexOf(uid)]){
  return asRole(db,'authenticated',uid===adminClaims.sub?adminClaims:{sub:uid},async()=>{
   await db.query("SELECT set_config('request.headers',$1,false)",[JSON.stringify(inst?{'x-examen-instancia':inst}:{})])
   return(await db.query('SELECT public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') dato',args)).rows[0].dato
  })
 }
 const admin=(n,a)=>rpc(adminClaims.sub,n,a)
 const sesion=(await admin('admin_examen_crear_sesion',[e.id,sociedad,JSON.stringify([{nombre:'Joven uno'},{nombre:'Joven dos'}])])).sesion_id
 const ids=(await db.query('SELECT id FROM public.participantes WHERE sesion_id=$1 ORDER BY nombre',[sesion])).rows.map(r=>r.id)
 return{db,e,users,instancias,rpc,admin,sesion,ids}
}
test('Efesios V3: distribución, autorización, rúbricas, tardanza y recuperación',async t=>{
 const f=await fixture();const {db,e,users,instancias,rpc,admin,sesion,ids}=f
 try{
 let a,b
 await t.test('el banco se congela al activar y no acepta valores fuera de la etapa',async()=>{
  await assert.rejects(asRole(db,'authenticated',adminClaims,()=>db.query("UPDATE public.preguntas SET texto='Cambio' WHERE etapa_id=$1",[e.id])),/quedan fijos/)
 })
 await t.test('un registro requiere validación del moderador y no expone preguntas',async()=>{
  a=await rpc(users[0],'examen_registrar',[sesion,ids[0]])
  assert.equal(a.acceso.pendiente,true);assert.equal(a.pregunta,null)
  await assert.rejects(rpc(users[0],'admin_examen_autorizar',[a.intento.id,'Soy el moderador']),{code:'42501'})
  await admin('admin_examen_autorizar',[a.intento.id,'Identidad comprobada en la sala'])
  await asRole(db,'authenticated',adminClaims,()=>db.query("UPDATE public.sesiones SET estado='activo' WHERE id=$1",[sesion]))
  a=await rpc(users[0],'examen_contacto',[a.intento.id])
  assert.equal(a.acceso.pendiente,false);assert.ok(a.pregunta)
 })
 await t.test('asigna exactamente 27/10/8, 116 puntos y snapshots de las rúbricas',async()=>{
  const q=(await db.query('SELECT tipo,count(*)::int n,sum(puntaje)::int puntos FROM public.intento_preguntas WHERE intento_id=$1 GROUP BY tipo ORDER BY tipo',[a.intento.id])).rows
  assert.deepEqual(q,[{tipo:'abierta',n:10,puntos:30},{tipo:'contexto',n:8,puntos:32},{tipo:'multiple',n:27,puntos:54}])
  const bancos=(await db.query('SELECT count(*)::int n FROM public.intento_preguntas WHERE intento_id=$1 AND tipo<>\'multiple\' AND jsonb_array_length(rubrica)>0',[a.intento.id])).rows[0].n
  assert.equal(bancos,18)
 })
 await t.test('añade un joven durante la evaluación y conserva el vencimiento global',async()=>{
  const nuevo=await admin('admin_examen_agregar',[sesion,'Joven tardío'])
  b=await rpc(users[1],'examen_registrar',[sesion,nuevo.participante_id])
  assert.equal(b.pregunta,null)
  assert.equal((await db.query('SELECT count(*)::int n FROM public.intento_preguntas WHERE intento_id=$1',[b.intento.id])).rows[0].n,0)
  await admin('admin_examen_autorizar',[b.intento.id,'Identidad del nuevo participante comprobada'])
  b=await rpc(users[1],'examen_contacto',[b.intento.id])
  assert.equal(b.intento.vence_at,a.intento.vence_at)
  const orden=async id=>(await db.query('SELECT pregunta_id,posicion FROM public.intento_preguntas WHERE intento_id=$1 ORDER BY posicion',[id])).rows
  assert.notDeepEqual(await orden(a.intento.id),await orden(b.intento.id))
  await assert.rejects(admin('admin_examen_agregar',[sesion,'Joven tardío']),/Ya existe/)
 })
 await t.test('otra pantalla no lee ni escribe el examen y el reingreso exige aprobación',async()=>{
  const otro=randomUUID()
  const bloqueado=await rpc(users[0],'examen_estado',[a.intento.id],otro)
  assert.equal(bloqueado.acceso.pendiente,true);assert.equal(bloqueado.pregunta,null)
  await assert.rejects(rpc(users[0],'examen_responder',[a.intento.id,a.pregunta.id,'Correcta',randomUUID()],otro),{code:'P0003'})
  await rpc(users[0],'examen_contacto',[a.intento.id,'solicitar',true,'Cerré la pestaña accidentalmente'],otro)
  await admin('admin_examen_autorizar',[a.intento.id,'Incidente accidental verificado por el moderador'])
  await assert.rejects(rpc(users[0],'examen_borrador',[a.intento.id,a.pregunta.id,'Prueba',0],instancias[0]),{code:'P0003'})
  instancias[0]=otro
  a=await rpc(users[0],'examen_contacto',[a.intento.id])
  assert.equal(a.acceso.pendiente,false)
 })
 await t.test('la pérdida de comunicación bloquea escrituras hasta autorizar sin extender tiempo',async()=>{
  const plazo=a.intento.vence_at
  await db.query("UPDATE app_private.control_intentos SET ultimo_contacto=clock_timestamp()-interval '90 seconds' WHERE intento_id=$1",[a.intento.id])
  await assert.rejects(rpc(users[0],'examen_responder',[a.intento.id,a.pregunta.id,'Correcta',randomUUID()]),{code:'P0003'})
  a=await rpc(users[0],'examen_contacto',[a.intento.id])
  assert.equal(a.acceso.pendiente,true)
  await admin('admin_examen_justificar',[a.intento.id,'Pérdida de comunicación verificada en sala'])
  assert.equal((await db.query('SELECT requiere_aprobacion FROM app_private.control_intentos WHERE intento_id=$1',[a.intento.id])).rows[0].requiere_aprobacion,true)
  await admin('admin_examen_autorizar',[a.intento.id,'Conexión revisada y participante presente'])
  a=await rpc(users[0],'examen_contacto',[a.intento.id])
  assert.equal(a.intento.vence_at,plazo)
 })
 await t.test('las respuestas escritas se califican por criterio y la operación queda auditada',async()=>{
  while(a.pregunta&&a.pregunta.tipo==='multiple')a=await rpc(users[0],'examen_responder',[a.intento.id,a.pregunta.id,'Correcta',randomUUID()])
  const qid=a.pregunta.id
  a=await rpc(users[0],'examen_responder',[a.intento.id,qid,'Explicación de prueba',randomUUID()])
  const r=(await db.query('SELECT id FROM public.respuestas WHERE intento_pregunta_id=$1',[qid])).rows[0].id
  await assert.rejects(admin('admin_examen_calificar',[r,1,'manual']),/rúbrica/)
  await assert.rejects(admin('admin_examen_calificar_rubrica',[r,JSON.stringify([99]),'']),/fuera/)
  await admin('admin_examen_calificar_rubrica',[r,JSON.stringify([1]),'Acredita parte del criterio'])
  assert.equal((await db.query("SELECT count(*)::int n FROM public.incidencias_examen WHERE intento_id=$1 AND tipo='calificacion'",[a.intento.id])).rows[0].n,1)
  await assert.rejects(admin('admin_examen_calificar_rubrica',[r,JSON.stringify([1]),'Revisión antigua',0]),{code:'40001'})
 })
 await t.test('un QR o código de traslado es personal, de un uso y revoca al dispositivo anterior',async()=>{
  const plazo=a.intento.vence_at,pos=a.pregunta.posicion
  const c=await admin('admin_examen_recuperacion',[a.intento.id])
  const rec=await rpc(users[2],'examen_recuperar',[sesion,c.codigo])
  assert.equal(rec.intento.vence_at,plazo);assert.equal(rec.pregunta.posicion,pos)
  await assert.rejects(rpc(users[0],'examen_estado',[a.intento.id]),{code:'42501'})
  await assert.rejects(rpc(users[0],'examen_recuperar',[sesion,c.codigo]),{code:'42501'})
 })
 await t.test('el cliente no puede leer controles privados ni editar la auditoría',async()=>{
  await asRole(db,'authenticated',{sub:users[2]},async()=>{
   await assert.rejects(db.query('SELECT * FROM app_private.control_intentos'),{code:'42501'})
   assert.equal((await db.query('SELECT * FROM public.incidencias_examen')).rows.length,0)
  })
  await assert.rejects(db.query('DELETE FROM public.incidencias_examen'),/inmutable/)
 })
 }finally{await db.close()}
})
test('ranking V2: consolida sociedades, incluye abandonos y comparte empates sin usar alertas ni velocidad',()=>{
 const datos={sesiones:[{id:'s1',sociedad_id:'A',estado:'finalizado'},{id:'s2',sociedad_id:'A',estado:'finalizado'},{id:'s3',sociedad_id:'B',estado:'finalizado'}],sociedades:[{id:'A',nombre:'A'},{id:'B',nombre:'B'}],participantes:[{id:'p1',nombre:'Uno',sesion_id:'s1',puntaje_total:9},{id:'p2',nombre:'Dos',sesion_id:'s2',puntaje_total:0},{id:'p3',nombre:'Tres',sesion_id:'s3',puntaje_total:9}],intentos:[{id:'i1',participante_id:'p1'},{id:'i2',participante_id:'p2'},{id:'i3',participante_id:'p3'}],intento_preguntas:[{id:'q1',intento_id:'i1',puntaje:10},{id:'q2',intento_id:'i2',puntaje:10},{id:'q3',intento_id:'i3',puntaje:10}],preguntas:[],respuestas:[],eventos_sesion:Array.from({length:50},(_,i)=>({id:'e'+i,sesion_id:'s3',participante_id:'p3'}))}
 const r=rankingEtapa(datos)
 assert.equal(r.rankingSociedades.length,2)
 assert.equal(r.rankingSociedades.find(s=>s.sociedad==='A').porcentaje,45)
 assert.equal(r.rankingSociedades[0].porcentaje,90)
 assert.equal(r.topJovenes[0].posicion,1);assert.equal(r.topJovenes[1].posicion,1)
 assert.equal(r.rankingSociedades[0].penalizacionPorcentaje,0)
})

test('la activación exige el cupo de cada tipo y las rúbricas con su valor correcto',async()=>{
 const db=await createTestDatabase()
 try{
  await applyMigrations(db)
  const e=(await db.query("SELECT id FROM public.etapas WHERE libro='Efesios'")).rows[0].id
  for(let n=0;n<45;n++)await db.query("INSERT INTO public.preguntas(etapa_id,tipo,texto,opciones,respuesta_correcta,puntaje) VALUES($1,'multiple','Prueba de cupos','[\"A\",\"B\"]','A',2)",[e])
  await assert.rejects(asRole(db,'authenticated',adminClaims,()=>db.query("UPDATE public.etapas SET estado='activa' WHERE id=$1",[e])),/Faltan preguntas revisadas/)
  await assert.rejects(db.query("INSERT INTO public.preguntas(etapa_id,tipo,texto,respuesta_correcta,puntaje) VALUES($1,'abierta','Pregunta','Referencia',3)",[e]),/criterios/)
  await assert.rejects(db.query("INSERT INTO public.preguntas(etapa_id,tipo,texto,respuesta_correcta,puntaje,rubrica) VALUES($1,'contexto','Pregunta','Referencia',4,$2::jsonb)",[e,JSON.stringify([{criterio:'Criterio',puntos:3}])]),/suma/)
 }finally{await db.close()}
})
test('la migración V3 se detiene antes de modificar una etapa que ya fue activada',async()=>{
 const db=await createTestDatabase()
 try{
  await applyMigrations(db,{through:'20261021170250'})
  const e=(await db.query("SELECT id FROM public.etapas WHERE libro='Efesios'")).rows[0].id
  await db.query("UPDATE public.etapas SET cantidad_preguntas=1 WHERE id=$1",[e])
  await db.query("INSERT INTO public.preguntas(etapa_id,tipo,texto,opciones,respuesta_correcta,puntaje) VALUES($1,'multiple','Prueba','[\"A\",\"B\"]','A',2)",[e])
  await db.query("UPDATE public.etapas SET estado='activa' WHERE id=$1",[e])
  const {readFile}=await import('node:fs/promises')
  await assert.rejects(db.exec(await readFile(new URL('../supabase/migrations/20261021200037_v3_efesios_supervision_evaluacion.sql',import.meta.url),'utf8')),/ya tiene actividad/)
  await db.exec('ROLLBACK')
  assert.equal((await db.query("SELECT count(*)::int n FROM information_schema.columns WHERE table_schema='public' AND table_name='preguntas' AND column_name='rubrica'")).rows[0].n,0)
 }finally{await db.close()}
})

test('Hebreos conserva el archivo pero el administrador de la app no puede leerlo ni abrir sus sesiones',async()=>{
 const db=await createTestDatabase()
 try{
  await applyMigrations(db,{through:'20261020193851'})
  const soc=(await db.query("INSERT INTO public.sociedades(nombre,iglesia) VALUES('Histórica','Prueba') RETURNING id")).rows[0].id
  await db.query("INSERT INTO public.sesiones(sociedad_id,estado) VALUES($1,'finalizado')",[soc])
  await applyMigrations(db,{existingV1:true})
  assert.equal((await db.query('SELECT count(*)::int n FROM public.archivos_etapa')).rows[0].n,1)
  await asRole(db,'authenticated',adminClaims,async()=>{
   assert.equal((await db.query('SELECT count(*)::int n FROM public.archivos_etapa')).rows[0].n,0)
   assert.equal((await db.query('SELECT count(*)::int n FROM public.sesiones')).rows[0].n,0)
   assert.equal((await db.query('SELECT count(*)::int n FROM public.etapas')).rows[0].n,2)
  })
 }finally{await db.close()}
})
