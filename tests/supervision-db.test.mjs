import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createTestDatabase,applyMigrations,asRole,adminClaims} from '../scripts/lib/local-database.mjs'
test('supervisión: permisos, incidentes agrupados y revisión sin cambiar pregunta ni plazo',async t=>{
 const db=await createTestDatabase();await applyMigrations(db)
 const e=(await db.query("SELECT id FROM public.etapas WHERE codigo='2026-02-efesios'")).rows[0].id,uid=randomUUID(),otro=randomUUID(),inst=randomUUID()
 await db.query('INSERT INTO auth.users(id) VALUES($1),($2)',[uid,otro])
 const sociedad=(await db.query("INSERT INTO public.sociedades(nombre,iglesia) VALUES('Supervisión local','Pruebas ficticias') RETURNING id")).rows[0].id
 for(const [tipo,puntos] of [['multiple',2],['abierta',3],['contexto',4]])await db.query('INSERT INTO public.preguntas(etapa_id,tipo,texto,opciones,respuesta_correcta,puntaje,rubrica) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7::jsonb)',[e,tipo,'Pregunta sintética '+tipo,tipo==='multiple'?JSON.stringify(['Correcta','B','C','D']):null,'Correcta',puntos,JSON.stringify(tipo==='multiple'?[]:[{criterio:'Concepto esperado',puntos}])])
 const rpc=(nombre,args,actor=uid,instancia=inst)=>asRole(db,'authenticated',actor===adminClaims.sub?adminClaims:{sub:actor},async()=>{await db.query("SELECT set_config('request.headers',$1,false)",[JSON.stringify({'x-examen-instancia':instancia})]);return(await db.query('SELECT public.'+nombre+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') dato',args)).rows[0].dato})
 const admin=(nombre,args)=>rpc(nombre,args,adminClaims.sub)
 const sesion=(await admin('admin_sesion_crear',[e,sociedad,'[{"nombre":"Participante de supervisión"}]',60,3])).sesion_id
 const sala=await rpc('examen_sala',[sesion]);let a=await rpc('examen_registrar',[sesion,sala.participantes[0].id]);await admin('admin_examen_autorizar',[a.intento.id,'Identidad verificada para supervisión'])
 await asRole(db,'authenticated',adminClaims,()=>db.query("UPDATE public.sesiones SET estado='activo' WHERE id=$1",[sesion]));a=await rpc('examen_contacto',[a.intento.id])
 const original=structuredClone(a),signal=(id,fase,senales,duracion,ausencia=0,observadas=senales)=>rpc('examen_supervisar',[a.intento.id,id,fase,JSON.stringify(senales),JSON.stringify(observadas),duracion,ausencia])
 try{
 await t.test('un participante ajeno, otra pantalla y señales inválidas no escriben',async()=>{
  const args=[a.intento.id,randomUUID(),'inicio','["sin_foco"]','["sin_foco"]',2000,2000]
  await assert.rejects(rpc('examen_supervisar',args,otro),{code:'42501'});await assert.rejects(rpc('examen_supervisar',args,uid,randomUUID()),{code:'42501'})
  await assert.rejects(signal(randomUUID(),'inicio',['aplicacion_espiada'],2000),/señal/i)
  await assert.rejects(signal(randomUUID(),'inicio',['sin_foco'],1000,2000),/inválida/)
  for(const usuario of [uid,adminClaims.sub])await assert.rejects(asRole(db,'authenticated',usuario===uid?{sub:uid}:adminClaims,()=>db.query('SELECT * FROM app_private.episodios_supervision')),{code:'42501'})
  await assert.rejects(rpc('admin_banco_importacion',[e]),{code:'42501'})
 })
 await t.test('la pantalla reducida es un indicio y no bloquea aunque sea prolongada',async()=>{
  const id=randomUUID();await signal(id,'inicio',['vista_reducida'],2000);await signal(id,'pulso',['vista_reducida'],50000);const fin=await signal(id,'fin',[],55000,0,['vista_reducida']);assert.equal(fin.acceso.pendiente,false)
  assert.equal((await db.query('SELECT count(*)::int n FROM app_private.episodios_supervision WHERE episodio=$1',[id])).rows[0].n,1)
 })
 await t.test('el servidor impide confirmar durante una ausencia sostenida, incluso sin pulso final',async()=>{
  const id=randomUUID();await signal(id,'inicio',['sin_foco'],2000,2000)
  await db.query("UPDATE app_private.episodios_supervision SET fuerte_desde=clock_timestamp()-interval '16 seconds' WHERE episodio=$1",[id])
  const texto=a.pregunta.tipo==='multiple'?a.pregunta.opciones[0]:'Texto de prueba'
  await assert.rejects(rpc('examen_responder',[a.intento.id,a.pregunta.id,texto,randomUUID()]),{code:'P0003'})
  a=await rpc('examen_contacto',[a.intento.id]);assert.equal(a.acceso.pendiente,true);assert.equal(a.pregunta,null)
  await signal(id,'fin',[],18000,18000,['sin_foco']);const panel=await admin('admin_examen_sala',[sesion,e]);assert.equal(panel.supervision.find(v=>v.episodio===id).requiere_revision,true)
  await admin('admin_examen_autorizar',[a.intento.id,'Interrupción revisada y participante presente']);a=await rpc('examen_contacto',[a.intento.id]);assert.equal(a.pregunta.id,original.pregunta.id);assert.equal(a.pregunta.posicion,original.pregunta.posicion);assert.equal(a.intento.vence_at,original.intento.vence_at)
  await signal(id,'inicio',['sin_foco'],20000,20000);assert.equal((await rpc('examen_estado',[a.intento.id])).acceso.pendiente,false)
 })
 await t.test('un cierre recuperado tras estar sin red solicita revisión y conserva las respuestas',async()=>{
  await signal(randomUUID(),'fin',[],22000,22000,['sin_foco']);a=await rpc('examen_estado',[a.intento.id]);assert.equal(a.acceso.pendiente,true);assert.equal(a.intento.respondidas,0)
  await admin('admin_examen_autorizar',[a.intento.id,'Red recuperada y causa revisada']);a=await rpc('examen_contacto',[a.intento.id]);assert.equal(a.pregunta.posicion,original.pregunta.posicion)
 })
 await t.test('la falta de soporte de fullscreen es informativa y se registra una sola vez',async()=>{
  for(let k=0;k<3;k++)await signal(randomUUID(),'fin',['pantalla_completa_no_disponible'],0)
  assert.equal((await rpc('examen_estado',[a.intento.id])).acceso.pendiente,false)
  assert.equal((await db.query("SELECT count(*)::int n FROM app_private.episodios_supervision WHERE senales @> '[\"pantalla_completa_no_disponible\"]'::jsonb")).rows[0].n,1)
 })
 await t.test('las opciones permanecen aleatorias en el intento y no se reordenan al recargar',async()=>{
  const opciones=(await db.query("SELECT id,opciones FROM public.intento_preguntas WHERE intento_id=$1 AND tipo='multiple'",[a.intento.id])).rows
  assert.deepEqual([...opciones[0].opciones].sort(),['B','C','Correcta','D'].sort());await rpc('examen_estado',[a.intento.id]);assert.deepEqual((await db.query("SELECT id,opciones FROM public.intento_preguntas WHERE intento_id=$1 AND tipo='multiple'",[a.intento.id])).rows,opciones)
 })
 }finally{await db.close()}
})
