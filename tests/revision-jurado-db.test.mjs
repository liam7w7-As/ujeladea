import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createTestDatabase, applyMigrations, asRole, adminClaims } from '../scripts/lib/local-database.mjs'

async function fixture() {
 const db=await createTestDatabase();await applyMigrations(db)
 const e=(await db.query("SELECT * FROM public.etapas WHERE codigo='2026-02-efesios'")).rows[0]
 const sesiones=[], respuestas=[], users=[randomUUID(),randomUUID(),randomUUID()], jurado2={sub:randomUUID(),app_metadata:{role:'admin'}}, instancias=[randomUUID(),randomUUID()]
 await db.query('INSERT INTO auth.users(id) SELECT unnest($1::uuid[])',[users])
 const rubrica=JSON.stringify([{criterio:'Primer elemento',puntos:1},{criterio:'Segundo elemento',puntos:1},{criterio:'Tercer elemento',puntos:1}])
 const preguntas=[]
 for(let k=0;k<2;k++) preguntas.push((await db.query("INSERT INTO public.preguntas(etapa_id,tipo,texto,respuesta_correcta,puntaje,rubrica) VALUES($1,'abierta',$2,'Referencia de prueba',3,$3::jsonb) RETURNING *",[e.id,'Pregunta sintética '+k,rubrica])).rows[0])
 for(const nombre of ['JERS','OTRA']) {
  const soc=(await db.query("INSERT INTO public.sociedades(nombre,iglesia) VALUES($1,'Prueba') RETURNING id",[nombre])).rows[0].id
  sesiones.push((await db.query("INSERT INTO public.sesiones(sociedad_id,etapa_id) VALUES($1,$2) RETURNING id",[soc,e.id])).rows[0].id)
 }
 for(let n=0;n<3;n++) {
  const s=sesiones[n===2?1:0]
  const p=(await db.query('INSERT INTO public.participantes(sesion_id,nombre) VALUES($1,$2) RETURNING id',[s,'Nombre privado '+n])).rows[0].id
  const i=(await db.query("INSERT INTO public.intentos(participante_id,usuario_id,sesion_id,etapa_id,cantidad_preguntas,estado,finalizado_at) VALUES($1,$2,$3,$4,45,'finalizado',clock_timestamp()) RETURNING id",[p,users[n],s,e.id])).rows[0].id
  for(const [j,q] of preguntas.entries()) {
   const pos=n===0?33+j:n===1?(j===0?35:33):20+j
   const a=(await db.query("INSERT INTO public.intento_preguntas(intento_id,pregunta_id,posicion,tipo,texto,respuesta_correcta,puntaje,rubrica) VALUES($1,$2,$3,'abierta',$4,$5,3,$6::jsonb) RETURNING id",[i,q.id,pos,q.texto,q.respuesta_correcta,rubrica])).rows[0].id
   respuestas.push((await db.query("INSERT INTO public.respuestas(participante_id,pregunta_id,intento_id,intento_pregunta_id,solicitud_id,respuesta_dada,puntaje_obtenido,calificado_por) VALUES($1,$2,$3,$4,$5,$6,NULL,'pendiente_ia') RETURNING id",[p,q.id,i,a,randomUUID(),'Respuesta privada sociedad '+(n===2?'OTRA':'JERS')+' '+n+' '+j])).rows[0].id)
  }
 }
 const rpc=(nombre,args,claims=adminClaims,rol='authenticated')=>asRole(db,rol,claims,async()=> (await db.query('SELECT public.'+nombre+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') dato',args)).rows[0].dato)
 const resumen=await rpc('admin_revision_resumen',[sesiones[0],e.id])
 const grupo=resumen.preguntas[0].clave
 const next=(inst=instancias[0],claims=adminClaims,modo='pendientes',excluir=[])=>rpc('admin_revision_siguiente',[sesiones[0],e.id,grupo,inst,modo,JSON.stringify(excluir)],claims)
 const draft=(r,puntos,accion='guardar',inst=instancias[0],claims=adminClaims,revision=0)=>rpc('admin_revision_borrador',[sesiones[0],e.id,r,inst,revision,JSON.stringify(puntos),'Comentario de borrador',accion,'Consultar al pastor'],claims)
 const save=(r,puntos,solicitud=randomUUID(),revision=0,inst=instancias[0],claims=adminClaims)=>rpc('admin_revision_guardar',[sesiones[0],e.id,r,inst,revision,JSON.stringify(puntos),'Observación',solicitud],claims)
 const service=(nombre,args)=>rpc(nombre,args,{},'service_role')
 return {db,e,sesiones,respuestas,users,jurado2,instancias,rpc,resumen,grupo,next,draft,save,service}
}

test('mesa del jurado: aislamiento, reservas, borradores, consulta y confirmación',async t=>{
 const f=await fixture(),{db,e,rpc,sesiones,next,draft,save,instancias,jurado2}=f
 try {
 await t.test('agrupa por pregunta real aunque la posición cambie y no carga identidades ni otras sociedades',async()=>{
  assert.equal(f.resumen.sociedad,'JERS');assert.equal(f.resumen.preguntas.length,2)
  assert.deepEqual(f.resumen.preguntas.map(g=>g.total),[2,2])
  const texto=JSON.stringify(f.resumen);assert.equal(texto.includes('Nombre privado'),false);assert.equal(texto.includes('Respuesta privada'),false)
  await assert.rejects(rpc('admin_revision_resumen',[sesiones[0],randomUUID()]),{code:'42501'})
  await assert.rejects(rpc('admin_revision_resumen',[sesiones[0],e.id],{sub:f.users[0]}),{code:'42501'})
  await assert.rejects(rpc('admin_revision_resumen',[sesiones[0],e.id],{},'anon'),{code:'42501'})
  assert.equal(await rpc('admin_revision_siguiente',[sesiones[0],e.id,'grupo inexistente',instancias[0]]),null)
 })
 let a,b
 await t.test('dos jurados reciben respuestas distintas, y una segunda pestaña del mismo jurado también se separa',async()=>{
  a=await next();b=await next(instancias[1],jurado2)
  assert.notEqual(a.id,b.id);assert.match(a.texto,/JERS/);assert.match(b.texto,/JERS/)
  assert.equal((await next()).id,a.id);assert.equal(await next(randomUUID()),null)
  await assert.rejects(save(a.id,[1,1,1],randomUUID(),0,instancias[1],jurado2),{code:'55P03'})
  await assert.rejects(draft(f.respuestas[4],[1,1,1]),{code:'42501'})
 })
 await t.test('recupera un borrador parcial, sin convertir criterios sin marcar en cero',async()=>{
  await draft(a.id,[1,null,0])
  const restaurado=await next();assert.deepEqual(restaurado.borrador,{puntos:[1,null,0],comentario:'Comentario de borrador'})
  for(const puntos of [[1,null,0],[1,1],[-1,1,1],[2,0,0],['1',1,1],[0.5,1,1]]) await assert.rejects(save(a.id,puntos))
  assert.equal((await db.query('SELECT puntaje_obtenido FROM public.respuestas WHERE id=$1',[a.id])).rows[0].puntaje_obtenido,null)
 })
 await t.test('guardar es idempotente y no duplica notas ni auditoría tras perder el acuse',async()=>{
  const op=randomUUID(),ack=await save(a.id,[1,0,1],op)
  assert.equal(ack.puntaje,2);assert.equal(ack.revision,1)
  assert.deepEqual(await save(a.id,[1,0,1],op),ack)
  await assert.rejects(save(a.id,[1,1,1],op),/otra revisión/)
  assert.equal((await db.query("SELECT count(*)::int n FROM public.incidencias_examen WHERE tipo='calificacion' AND detalle::jsonb->>'respuesta'=$1",[a.id])).rows[0].n,1)
 })
 await t.test('consulta conserva el borrador, sin calificar cero y separada de pendientes',async()=>{
  await draft(b.id,[null,1,null],'consulta',instancias[1],jurado2)
  assert.equal(await next(),null)
  const c=await next(instancias[0],adminClaims,'consulta');assert.equal(c.id,b.id);assert.equal(c.consulta,true)
  assert.deepEqual(c.borrador.puntos,[null,1,null])
  assert.equal((await db.query('SELECT puntaje_obtenido FROM public.respuestas WHERE id=$1',[b.id])).rows[0].puntaje_obtenido,null)
  await save(b.id,[0,1,1])
  assert.equal((await rpc('admin_revision_resumen',[sesiones[0],e.id])).preguntas[0].consultas,0)
 })
 await t.test('segunda revisión usa revisiones optimistas; una nota antigua no sobrescribe otra',async()=>{
  const r=await next(instancias[0],adminClaims,'revisadas')
  await assert.rejects(save(r.id,[1,1,1],randomUUID(),0),{code:'40001'})
  await save(r.id,[1,1,1],randomUUID(),r.revision)
  const otro=await next(instancias[0],adminClaims,'revisadas',[r.id]);assert.notEqual(otro.id,r.id)
  await assert.rejects(draft(otro.id,[1,1,1],'consulta',instancias[0],adminClaims,otro.revision),/segunda revisión/)
 })
 await t.test('una reserva vencida se puede recuperar y el propietario anterior deja de poder escribir',async()=>{
  const r=await next(instancias[0],adminClaims,'revisadas')
  await db.query("UPDATE app_private.revision_jurado SET reserva_hasta=clock_timestamp()-interval '1 second' WHERE respuesta_id=$1",[r.id])
  const nuevo=await next(instancias[1],jurado2,'revisadas');assert.equal(nuevo.id,r.id)
  await assert.rejects(save(r.id,[1,1,1],randomUUID(),r.revision),{code:'55P03'})
 })
 await t.test('ni administradores ni participantes acceden directamente a tablas privadas o presupuesto de servicio',async()=>{
  for(const claims of [adminClaims,{sub:f.users[0]}])await asRole(db,'authenticated',claims,async()=>{
   for(const tabla of ['revision_jurado','ia_presupuestos','ia_sugerencias'])await assert.rejects(db.query('SELECT * FROM app_private.'+tabla),{code:'42501'})
   await assert.rejects(db.query('SELECT public.servicio_ia_reservar($1,0,$2,0.1)',[f.respuestas[1],'v1']),{code:'42501'})
  })
 })
 }finally{await db.close()}
})

test('presupuesto IA: límite US$5, caché y liquidación conservadora solo desde servidor',async t=>{
 const f=await fixture(),{db,service,respuestas}=f,r=respuestas[0]
 const reservar=(v,c=.25)=>service('servicio_ia_reservar',[r,0,v,c])
 const terminar=(v,token,costo,resultado=null)=>service('servicio_ia_finalizar',[r,0,v,token,costo,resultado===null?null:JSON.stringify(resultado),'modelo-prueba'])
 try {
 await t.test('las reservas simultáneas cuentan antes del consumo y jamás exceden el tope',async()=>{
  const todas=await Promise.all(Array.from({length:21},(_,i)=>reservar('v'+i)))
  assert.equal(todas.filter(x=>x.estado==='reservada').length,20);assert.equal(todas[20].estado,'agotado')
  assert.equal((await reservar('v0')).estado,'ocupada')
  const costo=await terminar('v0',todas[0].token,.01,{criterios:[],puntaje:0})
  assert.equal(Number(costo.disponible),.24)
  const cache=await reservar('v0');assert.equal(cache.estado,'lista');assert.equal(cache.modelo,'modelo-prueba')
  await terminar('v0',todas[0].token,.01,{criterios:[],puntaje:0})
  assert.equal(Number((await db.query('SELECT gastado FROM app_private.ia_presupuestos')).rows[0].gastado),.01)
 })
 await t.test('si falta el coste, se carga la reserva completa; una interrupción no devuelve crédito ficticio',async()=>{
  const nuevo=await reservar('extra',.1)
  await terminar('extra',nuevo.token,null)
  assert.equal(Number((await db.query('SELECT gastado FROM app_private.ia_presupuestos')).rows[0].gastado),.11)
  await db.query("UPDATE app_private.ia_sugerencias SET vence_at=clock_timestamp()-interval '1 second' WHERE version='v1'")
  const despues=await reservar('v1');assert.equal(despues.estado,'agotado')
  const p=(await db.query('SELECT * FROM app_private.ia_presupuestos')).rows[0]
  assert.equal(Number(p.gastado),.36);assert.equal(Number(p.reservado),4.5)
 })
 await t.test('un token ajeno no libera dinero, y las notas se mantienen intactas',async()=>{
  await assert.rejects(terminar('v2',randomUUID(),0),{code:'42501'})
  assert.equal((await db.query("SELECT count(*)::int n FROM public.respuestas WHERE puntaje_obtenido IS NOT NULL")).rows[0].n,0)
  assert.equal((await db.query("SELECT count(*)::int n FROM app_private.ia_presupuestos b JOIN public.etapas e ON e.id=b.etapa_id WHERE e.historica")).rows[0].n,0)
 })
 }finally{await db.close()}
})
