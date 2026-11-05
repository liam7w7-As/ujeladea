import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import {createTestDatabase,applyMigrations,asRole,adminClaims} from '../scripts/lib/local-database.mjs'

test('asistencia y constancia: permisos, idempotencia y notas intactas', async t => {
 const db=await createTestDatabase()
 try {
  await applyMigrations(db)
  const user=randomUUID(), otro=randomUUID(), instancia=randomUUID()
  await db.query('INSERT INTO auth.users(id) VALUES($1),($2)',[user,otro])
  const etapa=(await db.query("SELECT * FROM public.etapas WHERE libro='Efesios'")).rows[0]
  const sociedad=(await db.query("INSERT INTO public.sociedades(nombre,iglesia) VALUES('UX','Prueba') RETURNING id")).rows[0].id
  for(const[tipo,n,puntos]of[['multiple',27,2],['abierta',10,3],['contexto',8,4]])for(let k=0;k<n;k++)await db.query('INSERT INTO public.preguntas(etapa_id,tipo,texto,opciones,respuesta_correcta,puntaje,rubrica) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7::jsonb)',[etapa.id,tipo,tipo+' ejemplo',tipo==='multiple'?JSON.stringify(['A','B']):null,tipo==='multiple'?'A':'Referencia privada',puntos,JSON.stringify(tipo==='multiple'?[]:[{criterio:'Criterio privado',puntos}])])
  await asRole(db,'authenticated',adminClaims,()=>db.query("UPDATE public.etapas SET estado='activa' WHERE id=$1",[etapa.id]))
  async function rpc(claims,nombre,args=[],pantalla=instancia){return asRole(db,'authenticated',claims,async()=>{await db.query("SELECT set_config('request.headers',$1,false)",[JSON.stringify({'x-examen-instancia':pantalla})]);return(await db.query('SELECT public.'+nombre+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') dato',args)).rows[0].dato})}
  const admin=(n,a)=>rpc(adminClaims,n,a), joven=(n,a)=>rpc({sub:user},n,a)
  const sesion=(await admin('admin_examen_crear_sesion',[etapa.id,sociedad,JSON.stringify([{nombre:'Joven de prueba'}])])).sesion_id
  const sala=await joven('examen_sala',[sesion])
  assert.deepEqual(sala.etapa.distribucion,{multiple:27,abierta:10,contexto:8})
  assert.equal(sala.sesion.tiempo_limite,etapa.tiempo_limite)
  let estado=await joven('examen_registrar',[sesion,sala.participantes[0].id])
  const intento=estado.intento.id
  await admin('admin_examen_autorizar',[intento,'Identidad comprobada en prueba local'])
  await asRole(db,'authenticated',adminClaims,()=>db.query("UPDATE public.sesiones SET estado='activo' WHERE id=$1",[sesion]))
  estado=await joven('examen_contacto',[intento])
  const antes=JSON.stringify((await db.query('SELECT puntaje_total FROM public.participantes WHERE id=$1',[sala.participantes[0].id])).rows)
  const vence=estado.intento.vence_at
  await t.test('el participante ajeno y la pantalla no autorizada no pueden pedir ayuda',async()=>{
   await assert.rejects(rpc({sub:otro},'examen_ayuda',[intento,'No puedo continuar']),{code:'42501'})
   await assert.rejects(rpc({sub:user},'examen_ayuda',[intento,'No puedo continuar'],randomUUID()),{code:'P0003'})
   await assert.rejects(joven('examen_ayuda',[intento,'Texto fuera de las categorías']))
  })
  let solicitud
  await t.test('reintentar una ayuda pendiente devuelve la misma solicitud sin alertas ni cambios de plazo',async()=>{
   const a=await joven('examen_ayuda',[intento,'No puedo continuar'])
   const b=await joven('examen_ayuda',[intento,'No puedo continuar'])
   solicitud=a.ayuda.id
   assert.equal(b.ayuda.id,solicitud)
   assert.equal(b.intento.vence_at,vence)
   assert.equal(b.intento.respondidas,0)
   assert.equal((await db.query('SELECT count(*)::int n FROM public.eventos_sesion WHERE intento_id=$1',[intento])).rows[0].n,0)
   const panel=await admin('admin_examen_sala',[sesion,etapa.id])
   assert.equal(panel.ayudas.length,1)
   assert.equal(panel.ayudas[0].nombre,'Joven de prueba')
  })
  await t.test('solo el moderador puede atender; repetir la acción no duplica el registro',async()=>{
   await assert.rejects(joven('admin_examen_atender_ayuda',[solicitud]),{code:'42501'})
   await admin('admin_examen_atender_ayuda',[solicitud]);await admin('admin_examen_atender_ayuda',[solicitud])
   assert.equal((await db.query("SELECT count(*)::int n FROM public.incidencias_examen WHERE tipo='ayuda_atendida'")).rows[0].n,1)
   assert.equal((await admin('admin_examen_sala',[sesion,etapa.id])).ayudas.length,0)
   assert.ok((await joven('examen_estado',[intento])).ayuda.atendida_at)
   await assert.rejects(joven('examen_ayuda',[intento,'No puedo continuar']),/Espera unos segundos/)
  })
  await t.test('la ayuda no altera notas, no expone corrección y la constancia usa el cierre real',async()=>{
   assert.equal(JSON.stringify((await db.query('SELECT puntaje_total FROM public.participantes WHERE id=$1',[sala.participantes[0].id])).rows),antes)
   const dto=JSON.stringify(await joven('examen_estado',[intento]))
   assert.ok(!dto.includes('Referencia privada')&&!dto.includes('Criterio privado'))
   await db.query("UPDATE public.intentos SET vence_at=clock_timestamp()-interval '1 second' WHERE id=$1",[intento])
   estado=await joven('examen_estado',[intento])
   assert.equal(estado.intento.estado,'finalizado')
   assert.equal(Date.parse(estado.intento.finalizado_at),new Date((await db.query('SELECT finalizado_at FROM public.intentos WHERE id=$1',[intento])).rows[0].finalizado_at).getTime())
   await assert.rejects(joven('examen_ayuda',[intento,'No puedo continuar']))
  })
  await t.test('sin sesión y sin RPC no se puede acceder a la asistencia',async()=>{
   await assert.rejects(asRole(db,'anon',{},()=>db.query('SELECT public.examen_ayuda($1,$2)',[intento,'No puedo continuar'])),{code:'42501'})
   assert.equal((await asRole(db,'authenticated',{sub:user},()=>db.query('SELECT * FROM public.incidencias_examen'))).rows.length,0)
  })
 } finally {await db.close()}
})
