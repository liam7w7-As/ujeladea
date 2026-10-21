import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createTestDatabase, applyMigrations, asRole, adminClaims } from '../scripts/lib/local-database.mjs'
import { calcularPremiacion } from '../src/lib/premiacion.js'

test('premiación: preserva V1, protege el resumen y verifica identidades sin modificar notas', async t => {
  const db=await createTestDatabase()
  const [sociedad,sesion,p1,p2,q]=Array.from({length:5},()=>randomUUID())
  try {
    await applyMigrations(db,{through:'20261020193851'})
    await db.query("INSERT INTO public.sociedades(id,nombre,iglesia) VALUES($1,'Sociedad histórica','Iglesia de prueba')",[sociedad])
    await db.query("INSERT INTO public.sesiones(id,sociedad_id,estado) VALUES($1,$2,'finalizado')",[sesion,sociedad])
    for(const [id,nombre,puntos] of [[p1,'Mismo nombre',20],[p2,'Otra persona',10]])
      await db.query("INSERT INTO public.participantes(id,sesion_id,nombre,puntaje_total,examen_finalizado) VALUES($1,$2,$3,$4,true)",[id,sesion,nombre,puntos])
    await db.query("INSERT INTO public.preguntas(id,tipo,texto,respuesta_correcta,puntaje) VALUES($1,'multiple','Histórica','A',10)",[q])
    for(const id of [p1,p1,p2])
      await db.query("INSERT INTO public.respuestas(participante_id,pregunta_id,respuesta_dada,puntaje_obtenido,calificado_por) VALUES($1,$2,'A',10,'sistema')",[id,q])
    for(let i=0;i<25;i++)await db.query("INSERT INTO public.eventos_sesion(participante_id,sesion_id,tipo) VALUES($1,$2,'cambio_pestana')",[p1,sesion])
    await applyMigrations(db,{existingV1:true})
    const admin=(nombre,args=[])=>asRole(db,'authenticated',adminClaims,async()=>(
      await db.query('SELECT public.'+nombre+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') dato',args)).rows[0].dato)
    const hashAntes=(await db.query('SELECT md5(contenido::text) h FROM public.archivos_etapa')).rows[0].h
    let resumen=await admin('admin_premiacion_resumen')
    await t.test('conserva respuestas duplicadas y descuento V1 en el resumen congelado',async()=>{
      const h=resumen.hebreos.sociedades[0]
      assert.equal(h.puntajeObtenido,30)
      assert.equal(h.puntajeMaximo,30)
      assert.equal(h.penalizacionPorcentaje,5)
      assert.equal(h.nota,95)
      assert.equal(h.rindieron,2)
      assert.equal(resumen.hebreos.participantes.find(p=>p.id===p1).puntaje,20)
      assert.equal(resumen.validacion_pdf,null)
      await assert.rejects(db.query("UPDATE app_private.resultados_hebreos SET contenido='{}'"),/inmutable/)
    })
    await t.test('no expone preguntas ni respuestas, y exige un administrador real',async()=>{
      assert.ok(!JSON.stringify(resumen).includes('respuesta_correcta'))
      for(const claims of [{},{sub:randomUUID()},{sub:randomUUID(),user_metadata:{role:'admin'}}])
        await asRole(db,'authenticated',claims,()=>assert.rejects(db.query('SELECT public.admin_premiacion_resumen()'),{code:'42501'}))
      await asRole(db,'anon',{},()=>assert.rejects(db.query('SELECT public.admin_premiacion_resumen()'),{code:'42501'}))
      for(const tabla of ['resultados_hebreos','validacion_pdf_hebreos','vinculos_premiacion','auditoria_premiacion'])
        await asRole(db,'authenticated',adminClaims,()=>assert.rejects(db.query('SELECT * FROM app_private.'+tabla),{code:'42501'}))
      const wrappers=(await db.query("SELECT prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname LIKE 'admin_premiacion_%'")).rows
      assert.equal(wrappers.length,3);assert.ok(wrappers.every(x=>!x.prosecdef))
    })
    const e=(await db.query("SELECT id FROM public.etapas WHERE libro='Efesios'")).rows[0].id
    const es=(await db.query("INSERT INTO public.sesiones(etapa_id,sociedad_id) VALUES($1,$2) RETURNING id",[e,sociedad])).rows[0].id
    const ids=[]
    for(const nombre of ['Mismo nombre','Nuevo participante'])
      ids.push((await db.query('INSERT INTO public.participantes(sesion_id,nombre) VALUES($1,$2) RETURNING id',[es,nombre])).rows[0].id)
    await t.test('una coincidencia de nombres no crea una identidad y el vínculo es uno a uno',async()=>{
      assert.deepEqual(resumen.vinculos,[])
      resumen=await admin('admin_premiacion_vincular',[ids[0],p1,'Identidad contrastada con el registro anterior',0])
      assert.equal(resumen.vinculos[0].hebreos,p1)
      await assert.rejects(admin('admin_premiacion_vincular',[ids[1],p1,'Otro registro para la misma persona',0]),{code:'23505'})
      await assert.rejects(admin('admin_premiacion_vincular',[ids[0],p2,'Pantalla con una revisión antigua',0]),{code:'40001'})
      await assert.rejects(admin('admin_premiacion_vincular',[p1,p2,'Participante de una etapa incorrecta',0]),/Efesios/)
      resumen=await admin('admin_premiacion_vincular',[ids[1],null,'Se confirmó que participó únicamente en Efesios',0])
      assert.equal(resumen.vinculos.length,2)
      assert.equal(resumen.vinculos.find(v=>v.efesios===ids[1]).hebreos,null)
    })
    await t.test('contrastar el PDF exige declaración explícita, conserva su huella y no reescribe notas',async()=>{
      await assert.rejects(admin('admin_premiacion_validar_pdf',['a'.repeat(64),'Comparación con el PDF de resultados original',false]),/Confirma/)
      await assert.rejects(admin('admin_premiacion_validar_pdf',['invalido','Comparación con el PDF de resultados original',true]),/Confirma/)
      resumen=await admin('admin_premiacion_validar_pdf',['a'.repeat(64),'Comparación con el PDF de resultados original',true])
      assert.equal(resumen.validacion_pdf.sha256,'a'.repeat(64))
      await assert.rejects(admin('admin_premiacion_validar_pdf',['b'.repeat(64),'Intento de sustituir una comprobación anterior',true]),/no puede sustituirse/)
      assert.equal((await db.query('SELECT md5(contenido::text) h FROM public.archivos_etapa')).rows[0].h,hashAntes)
      assert.equal((await db.query('SELECT puntaje_total FROM public.participantes WHERE id=$1',[p1])).rows[0].puntaje_total,20)
      assert.equal((await db.query('SELECT count(*)::int n FROM public.respuestas')).rows[0].n,3)
      assert.equal((await db.query('SELECT count(*)::int n FROM app_private.auditoria_premiacion')).rows[0].n,3)
      await assert.rejects(db.query("DELETE FROM app_private.auditoria_premiacion"),/inmutable/)
    })
  } finally {await db.close()}
})

function ejemplo() {
  const datos={sociedades:[{id:'s',nombre:'Sociedad'}],sesiones:[{id:'sesion',sociedad_id:'s',estado:'finalizado'}],
    participantes:[{id:'e1',sesion_id:'sesion',nombre:'Mismo nombre',puntaje_total:58},{id:'e2',sesion_id:'sesion',nombre:'Nuevo participante',puntaje_total:58}],
    preguntas:[],respuestas:[],eventos_sesion:[],intentos:[],intento_preguntas:[]}
  for(const [p,id] of [['e1','i1'],['e2','i2']]) {
    datos.intentos.push({id,participante_id:p,estado:'finalizado'})
    datos.intento_preguntas.push({id:'q'+p,intento_id:id,puntaje:116})
    datos.respuestas.push({id:'r'+p,participante_id:p,intento_pregunta_id:'q'+p,puntaje_obtenido:58,calificado_por:'manual'})
  }
  return {datos,etapa:{estado:'cerrada'},resumen:{validacion_pdf:{sha256:'a'.repeat(64)},
    hebreos:{sociedades:[{sociedadId:'s',sociedad:'Sociedad',nota:90,pendientes:0}],
      participantes:[{id:'h1',nombre:'Mismo nombre',nota:80,puntajeMax:100,pendientes:0}]},vinculos:[]}}
}
test('acumulado 50/50: no confunde nombres, no asigna cero a una ausencia y respeta el resultado V1',()=>{
  const f=ejemplo(),antes=structuredClone(f.resumen.hebreos)
  let c=calcularPremiacion(f.resumen,f.datos,f.etapa)
  assert.equal(c.sociedades[0].total,70)
  assert.equal(c.individuales[0].total,null)
  assert.equal(c.provisional,true)
  f.resumen.vinculos=[{efesios:'e1',hebreos:'h1',revision:1},{efesios:'e2',hebreos:null,revision:1}]
  c=calcularPremiacion(f.resumen,f.datos,f.etapa)
  assert.equal(c.individuales.find(p=>p.id==='e1').total,65)
  assert.equal(c.individuales.find(p=>p.id==='e2').total,null)
  assert.equal(c.provisional,false)
  assert.deepEqual(f.resumen.hebreos,antes)
  f.resumen.hebreos.sociedades=[]
  c=calcularPremiacion(f.resumen,f.datos,f.etapa)
  assert.equal(c.sociedades[0].total,null)
})
test('un PDF sin contrastar, notas pendientes o varias sesiones V1 impiden declarar un acumulado definitivo',()=>{
  const f=ejemplo()
  f.resumen.validacion_pdf=null
  f.resumen.hebreos.sociedades.push({...f.resumen.hebreos.sociedades[0]})
  const c=calcularPremiacion(f.resumen,f.datos,f.etapa)
  assert.equal(c.sociedades[0].total,null)
  assert.match(c.sociedades[0].motivo,/varias sesiones/)
  assert.equal(c.provisional,true)
})
