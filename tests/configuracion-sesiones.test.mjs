import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createTestDatabase,applyMigrations,asRole,adminClaims} from '../scripts/lib/local-database.mjs'
import {distribucionExamen} from '../src/lib/modelo-efesios.js'
import {rankingEtapa} from '../src/lib/etapas.js'
import {prepararInformeEtapa} from '../src/lib/informe-etapa.js'
import {calcularPremiacion} from '../src/lib/premiacion.js'
async function fixture(){
 const db=await createTestDatabase();await applyMigrations(db)
 const e=(await db.query("SELECT * FROM public.etapas WHERE codigo='2026-02-efesios'")).rows[0]
 const sociedad=(await db.query("INSERT INTO public.sociedades(nombre,iglesia) VALUES('Sociedad configuración','Prueba local') RETURNING id")).rows[0].id
 for(const [tipo,n,puntos] of [['multiple',30,2],['abierta',12,3],['contexto',10,4]])for(let k=0;k<n;k++)await db.query('INSERT INTO public.preguntas(etapa_id,tipo,texto,opciones,respuesta_correcta,puntaje,rubrica) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7::jsonb)',[e.id,tipo,'Pregunta sintética '+tipo+' '+k,tipo==='multiple'?JSON.stringify(['Correcta','Otra']):null,'Correcta',puntos,JSON.stringify(tipo==='multiple'?[]:Array.from({length:puntos},(_,i)=>({criterio:'Elemento '+i,puntos:1})))])
 const users=[randomUUID(),randomUUID(),randomUUID()],instances=users.map(()=>randomUUID())
 await db.query('INSERT INTO auth.users(id) SELECT unnest($1::uuid[])',[users])
 const rpc=(name,args,uid=adminClaims.sub,inst=instances[users.indexOf(uid)])=>asRole(db,'authenticated',uid===adminClaims.sub?adminClaims:{sub:uid},async()=>{
  await db.query("SELECT set_config('request.headers',$1,false)",[JSON.stringify(inst?{'x-examen-instancia':inst}:{})])
  return(await db.query('SELECT public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') dato',args)).rows[0].dato
 })
 const crear=(n=6,min=3,nombres=['Persona uno','Persona dos'])=>rpc('admin_sesion_crear',[e.id,sociedad,JSON.stringify(nombres.map(nombre=>({nombre}))),min,n]).then(x=>x.sesion_id)
 const actualizar=(id,estado)=>asRole(db,'authenticated',adminClaims,()=>db.query('UPDATE public.sesiones SET estado=$2 WHERE id=$1',[id,estado]))
 const datos=async()=>{const d={};for(const tabla of ['sesiones','sociedades','participantes','preguntas','respuestas','eventos_sesion','intentos','intento_preguntas'])d[tabla]=(await db.query('SELECT * FROM public.'+tabla)).rows;return d}
 return{db,e,sociedad,users,instances,rpc,crear,actualizar,datos}
}

test('sesiones normales con minutos y preguntas propios; eliminación sin puntuar después',async t=>{
 const f=await fixture(),{db,e,rpc,crear,actualizar,users,instances,datos}=f
 let sesion,a,b
 try{
 await t.test('cliente y base distribuyen de forma idéntica de 1 a 200 preguntas',async()=>{
  const rows=(await db.query('SELECT n,app_private.distribucion_examen(n) d FROM generate_series(1,200) n')).rows
  for(const {n,d} of rows){assert.deepEqual(d,distribucionExamen(n));assert.equal(Object.values(d).reduce((a,b)=>a+b,0),n);if(n>=3)assert.ok(Object.values(d).every(v=>v>=1))}
  assert.deepEqual(distribucionExamen(45),{multiple:27,abierta:10,contexto:8})
 })
 await t.test('se edita la preparación sin forzar 45; las sesiones conservan su propia configuración',async()=>{
  await asRole(db,'authenticated',adminClaims,()=>db.query('UPDATE public.etapas SET tiempo_limite=7,cantidad_preguntas=10,reglas=reglas||jsonb_build_object(\'distribucion\',app_private.distribucion_examen(10)) WHERE id=$1',[e.id]))
  sesion=await crear(6,3)
  const s=(await db.query('SELECT * FROM public.sesiones WHERE id=$1',[sesion])).rows[0]
  assert.equal(s.tiempo_limite,3);assert.equal(s.cantidad_preguntas,6);assert.deepEqual(s.distribucion,{multiple:4,abierta:1,contexto:1})
  await asRole(db,'authenticated',adminClaims,()=>db.query('UPDATE public.etapas SET tiempo_limite=60,cantidad_preguntas=45,reglas=reglas||jsonb_build_object(\'distribucion\',app_private.distribucion_examen(45)),estado=\'activa\' WHERE id=$1',[e.id]))
  assert.equal((await db.query('SELECT cantidad_preguntas FROM public.sesiones WHERE id=$1',[sesion])).rows[0].cantidad_preguntas,6)
  for(const [n,min] of [[0,3],[201,3],[6,0],[6,241],[null,3]])await assert.rejects(crear(n,min,['Inválido']))
  await assert.rejects(rpc('admin_sesion_crear',[e.id,f.sociedad,'[{"nombre":"No autorizado"}]',3,6],users[2]),{code:'42501'})
 })
 await t.test('el flujo normal mantiene autorización y asigna exactamente seis preguntas con cierre de tres minutos',async()=>{
  const sala=await rpc('examen_sala',[sesion],users[0]);assert.equal(sala.etapa.cantidad_preguntas,6);assert.equal(sala.sesion.tiempo_limite,3)
  a=await rpc('examen_registrar',[sesion,sala.participantes[0].id],users[0]);assert.equal(a.pregunta,null)
  b=await rpc('examen_registrar',[sesion,sala.participantes[1].id],users[1])
  for(const i of [a,b])await rpc('admin_examen_autorizar',[i.intento.id,'Identidad de prueba verificada'])
  await actualizar(sesion,'activo');a=await rpc('examen_contacto',[a.intento.id],users[0])
  assert.equal(a.intento.total,6);assert.ok(a.pregunta)
  const tipos=(await db.query('SELECT tipo,count(*)::int n FROM public.intento_preguntas WHERE intento_id=$1 GROUP BY tipo ORDER BY tipo',[a.intento.id])).rows
  assert.deepEqual(tipos,[{tipo:'abierta',n:1},{tipo:'contexto',n:1},{tipo:'multiple',n:4}])
  const tiempo=(await db.query('SELECT extract(epoch from (vence_at-iniciado_at))::int segundos FROM public.intentos WHERE id=$1',[a.intento.id])).rows[0].segundos
  assert.equal(tiempo,180)
  await assert.rejects(asRole(db,'authenticated',adminClaims,()=>db.query('UPDATE public.sesiones SET cantidad_preguntas=2 WHERE id=$1',[sesion])),/configuración.*fija/)
 })
 await t.test('contesta y califica una sesión normal corta con notas sobre 100',async()=>{
  while(a.pregunta)a=await rpc('examen_responder',[a.intento.id,a.pregunta.id,'Correcta',randomUUID()],users[0])
  await actualizar(sesion,'finalizado')
  const pendientes=(await db.query("SELECT r.id,r.revision_calificacion,q.rubrica FROM public.respuestas r JOIN public.intento_preguntas q ON q.id=r.intento_pregunta_id WHERE r.calificado_por='pendiente_ia'")).rows
  for(const r of pendientes)await rpc('admin_examen_calificar_rubrica',[r.id,JSON.stringify(r.rubrica.map(()=>1)),'Referencia satisfecha',r.revision_calificacion])
  assert.equal(rankingEtapa(await datos()).todosJovenes[0].efectividad,100)
 })
 let huella
 await t.test('eliminar exige confirmar y retira la sesión sin recalificar sus respuestas',async()=>{
  huella=(await db.query('SELECT md5(jsonb_agg(to_jsonb(r) ORDER BY id)::text) h FROM public.respuestas r')).rows[0].h
  await assert.rejects(rpc('admin_sesion_eliminar',[sesion,e.id,'NO']),/Confirma/)
  await assert.rejects(rpc('admin_sesion_eliminar',[sesion,e.id,'ELIMINAR'],users[2]),{code:'42501'})
  await assert.rejects(rpc('admin_sesion_eliminar',[sesion,randomUUID(),'ELIMINAR']),{code:'42501'})
  await rpc('admin_sesion_eliminar',[sesion,e.id,'ELIMINAR'])
  assert.equal((await rpc('admin_sesion_eliminar',[sesion,e.id,'ELIMINAR'])).eliminada,true)
  assert.equal((await db.query('SELECT md5(jsonb_agg(to_jsonb(r) ORDER BY id)::text) h FROM public.respuestas r')).rows[0].h,huella)
 })
 await t.test('ranking, informe y premiación excluyen completamente una sesión eliminada',async()=>{
  const d=await datos();assert.equal(rankingEtapa(d).todosJovenes.length,0);assert.equal(rankingEtapa(d).rankingSociedades.length,0)
  const informe=prepararInformeEtapa({etapa:{...e,estado:'activa'},datos:d});assert.equal(informe.resumen.registrados,0);assert.equal(informe.resumen.sesiones,0);assert.equal(informe.sociedades.length,0)
  const p=calcularPremiacion({hebreos:{sociedades:[],participantes:[]},vinculos:[]},d,e);assert.equal(p.individuales.length,0);assert.equal(p.sociedades.length,0)
 })
 await t.test('una pestaña antigua no lee ni escribe y los mismos nombres y dispositivos pueden iniciar otra sesión',async()=>{
  await assert.rejects(rpc('examen_sala',[sesion],users[0]),{code:'42501'})
  await assert.rejects(rpc('examen_estado',[a.intento.id],users[0]),{code:'42501'})
  await assert.rejects(rpc('admin_revision_resumen',[sesion,e.id]),{code:'42501'})
  await assert.rejects(rpc('admin_examen_agregar',[sesion,'Otra persona']),/terminó|eliminada/)
  const nueva=await crear(3,2),sala=await rpc('examen_sala',[nueva],users[0])
  const nuevo=await rpc('examen_registrar',[nueva,sala.participantes[0].id],users[0]);assert.notEqual(nuevo.intento.id,a.intento.id)
  await rpc('admin_examen_autorizar',[nuevo.intento.id,'Persona verificada en nueva sesión']);await actualizar(nueva,'activo')
  const rec=await rpc('admin_examen_recuperacion',[nuevo.intento.id])
  const r=await rpc('examen_recuperar',[nueva,rec.codigo],users[1],instances[1]);assert.equal(r.intento.total,3)
  await rpc('admin_sesion_eliminar',[nueva,e.id,'ELIMINAR'])
 })
 await t.test('el cierre omite sesiones eliminadas y Hebreos sigue bloqueado',async()=>{
  await asRole(db,'authenticated',adminClaims,()=>db.query("UPDATE public.etapas SET estado='cerrada' WHERE id=$1",[e.id]))
  const archivo=(await db.query('SELECT contenido FROM public.archivos_etapa WHERE etapa_id=$1',[e.id])).rows[0].contenido
  assert.equal(archivo.datos.sesiones.length,0);assert.equal(archivo.datos.participantes.length,0);assert.equal(archivo.datos.respuestas.length,0);assert.equal(archivo.datos.incidencias_examen.length,0)
  const h=(await db.query("SELECT id FROM public.etapas WHERE historica")).rows[0].id
  await assert.rejects(rpc('admin_sesion_eliminar',[sesion,h,'ELIMINAR']),{code:'42501'})
 })
 }finally{await db.close()}
})
