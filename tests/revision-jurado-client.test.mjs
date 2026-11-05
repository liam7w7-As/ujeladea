import test from 'node:test'
import assert from 'node:assert/strict'
import { RevisionJurado, instanciaRevision, validarPuntosRevision } from '../src/lib/revision-jurado.js'

const grupo={clave:'q1',texto:'Pregunta',maximo:2,rubrica:[{criterio:'Uno',puntos:1},{criterio:'Dos',puntos:1}],pendientes:2,consultas:0}
function fixture(extra={}) {
 const datos=new Map(),storage={getItem:k=>datos.get(k),setItem:(k,v)=>datos.set(k,v),removeItem:k=>datos.delete(k)},calls=[]
 let disponible={id:'respuesta-1',revision:0,texto:'Respuesta de prueba',pendiente:true},confirmada=false,revision=0
 const mock={rpc:async(nombre,args)=>{
  calls.push({nombre,args})
  if(nombre==='admin_revision_resumen')return{data:{sociedad:'JERS',preguntas:[grupo,{...grupo,clave:'q2'}]}}
  if(nombre==='admin_revision_siguiente')return{data:disponible}
  if(nombre==='admin_revision_borrador')return{data:{guardado:true}}
  if(nombre==='admin_revision_guardar'){
   if(!confirmada){confirmada=true;revision++;disponible={id:'respuesta-2',revision:0,texto:'Otra respuesta',pendiente:true}}
   return{data:{revision}}
  }
 }}
 const client={...mock,...extra}
 const control=new RevisionJurado({client,sesion:'sesion-JERS',etapa:'Efesios',actor:'jurado',instancia:'pantalla-1',storage})
 return {control,client,mock,storage,datos,calls}
}
const diferida=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return{promise,resolve}}

test('los criterios comienzan vacíos; no guarda incompletos y toda solicitud queda en la sesión seleccionada',async()=>{
 const f=fixture(),c=f.control
 try{
  await c.iniciar();assert.deepEqual(c.state.puntos,[null,null]);assert.equal(validarPuntosRevision(c.state.puntos,grupo),false)
  await c.guardar();assert.match(c.state.error,/Marca todos/);assert.equal(f.calls.some(x=>x.nombre==='admin_revision_guardar'),false)
  c.editar({puntos:[1,0]});await c.guardar();assert.equal(c.state.item.id,'respuesta-2')
  assert.ok(f.calls.every(x=>x.args.p_sesion==='sesion-JERS'&&x.args.p_etapa==='Efesios'))
 }finally{c.destruir()}
})

test('un doble clic genera una sola confirmación y espera el acuse antes de avanzar',async()=>{
 const espera=diferida(),f=fixture(),original=f.client.rpc
 f.client.rpc=async(n,a)=>{if(n==='admin_revision_guardar')await espera.promise;return original(n,a)}
 const c=f.control
 try{
  await c.iniciar();c.editar({puntos:[1,1]})
  const envio=c.guardar();const segundo=await c.guardar();assert.equal(segundo,false);assert.equal(c.state.item.id,'respuesta-1')
  espera.resolve();await envio
  assert.equal(f.calls.filter(x=>x.nombre==='admin_revision_guardar').length,1);assert.equal(c.state.item.id,'respuesta-2')
 }finally{c.destruir()}
})

test('un acuse perdido congela la revisión y reintenta con la misma solicitud y puntos',async()=>{
 const f=fixture(),original=f.client.rpc;let falla=true
 f.client.rpc=async(n,a)=>{
  const result=await original(n,a)
  if(n==='admin_revision_guardar'&&falla){falla=false;return{error:{message:'Se perdió la confirmación'}}}
  return result
 }
 const c=f.control
 try{
  await c.iniciar();c.editar({puntos:[1,0],comentario:'Criterio parcial'});assert.equal(await c.guardar(),false)
  assert.equal(c.state.item.id,'respuesta-1');assert.equal(c.state.commitPendiente,true)
  c.editar({puntos:[0,0]});assert.deepEqual(c.state.puntos,[1,0]);assert.equal(await c.cambiar('q2','pendientes'),false)
  await c.guardar()
  const envios=f.calls.filter(x=>x.nombre==='admin_revision_guardar');assert.deepEqual(envios[0].args,envios[1].args)
  assert.equal(c.state.item.id,'respuesta-2');assert.equal(c.state.commitPendiente,false)
 }finally{c.destruir()}
})

test('recargar resuelve un envío sin confirmar antes de tomar otra respuesta',async()=>{
 const f=fixture(),original=f.client.rpc
 f.client.rpc=async(n,a)=>n==='admin_revision_guardar'?(await original(n,a),{error:{message:'Sin acuse'}}):original(n,a)
 const c=f.control
 await c.iniciar();c.editar({puntos:[1,1]});await c.guardar();c.destruir()
 f.client.rpc=original
 const nuevo=new RevisionJurado({client:f.client,sesion:'sesion-JERS',etapa:'Efesios',actor:'jurado',instancia:'pantalla-1',storage:f.storage})
 try{
  const inicio=f.calls.length;await nuevo.iniciar()
  assert.equal(f.calls[inicio].nombre,'admin_revision_guardar');assert.equal(nuevo.state.item.id,'respuesta-2')
  assert.equal(f.datos.has(nuevo.clave+':envio'),false)
 }finally{nuevo.destruir()}
})

test('recupera el borrador de la misma revisión y evita usar el de otra sociedad o revisión',async()=>{
 const f=fixture(),c=f.control
 try{
  f.storage.setItem(c.clave+':respuesta-1:0',JSON.stringify({puntos:[null,1],comentario:'Nota local'}))
  await c.iniciar();assert.deepEqual(c.state.puntos,[null,1]);assert.equal(c.state.comentario,'Nota local')
  assert.match(c.state.borrador,/recuperado/)
  const otro=new RevisionJurado({client:f.client,sesion:'otra',etapa:'Efesios',actor:'jurado',instancia:'pantalla-2',storage:f.storage})
  try{await otro.iniciar();assert.deepEqual(otro.state.puntos,[null,null])}finally{otro.destruir()}
 }finally{c.destruir()}
})

test('fallar al sincronizar antes de cambiar conserva la respuesta y no toma otra',async()=>{
 const f=fixture(),original=f.client.rpc,c=f.control
 try{
  await c.iniciar();c.editar({puntos:[1,null],comentario:'No perder'})
  f.client.rpc=async(n,a)=>n==='admin_revision_borrador'?{error:{message:'No hay conexión'}}:original(n,a)
  assert.equal(await c.cambiar('q2','consulta'),false)
  assert.equal(c.state.item.id,'respuesta-1');assert.equal(c.state.grupo,'q1');assert.equal(c.state.comentario,'No perder')
  assert.equal(f.calls.filter(x=>x.nombre==='admin_revision_siguiente').length,1)
 }finally{c.destruir()}
})

test('una propuesta tardía para otra respuesta no rellena ni califica la actual',async()=>{
 const f=fixture(),c=f.control,espera=diferida()
 f.client.functions={invoke:()=>espera.promise}
 try{
  await c.iniciar();const ai=c.sugerir();await c.cambiar('q2','pendientes')
  // Misma respuesta simulada pero con revisión posterior: tampoco se aplica la anterior.
  c.emitir({item:{...c.state.item,revision:1}})
  espera.resolve({data:{respuesta_id:'respuesta-1',revision:0,criterios:[{puntos:1},{puntos:1}]}});await ai
  assert.equal(c.state.sugerencia,null);assert.deepEqual(c.state.puntos,[null,null])
  assert.equal(f.calls.some(x=>x.nombre==='admin_revision_guardar'),false)
 }finally{c.destruir()}
})

test('sin almacenamiento también reintenta el mismo envío en memoria; nuevas pestañas tienen otra reserva',async()=>{
 const f=fixture(),c=f.control,original=f.client.rpc;let falla=true
 c.storage={getItem:()=>{throw Error()},setItem:()=>{throw Error()},removeItem:()=>{throw Error()}}
 f.client.rpc=async(n,a)=>{const res=await original(n,a);if(n==='admin_revision_guardar'&&falla){falla=false;return{error:{message:'Sin acuse'}}}return res}
 try{
  await c.iniciar();c.editar({puntos:[1,0]});await c.guardar();await c.guardar()
  const envios=f.calls.filter(x=>x.nombre==='admin_revision_guardar');assert.equal(envios[0].args.p_solicitud,envios[1].args.p_solicitud)
  const id=instanciaRevision(f.storage);assert.equal(instanciaRevision(f.storage,true),id);assert.notEqual(instanciaRevision(f.storage,false),id)
 }finally{c.destruir()}
})

test('una revisión rechazada por conflicto conserva el borrador y permite recargar sin repetir el envío',async()=>{
 for(const code of ['40001','55P03']){
  const f=fixture(),c=f.control,original=f.client.rpc
  try{
   await c.iniciar();c.editar({puntos:[1,0],comentario:'No sobrescribir otra nota'})
   f.client.rpc=async(n,a)=>n==='admin_revision_guardar'?{error:{code,message:'Otra revisión cambió esta respuesta'}}:original(n,a)
   assert.equal(await c.guardar(),false);assert.equal(c.state.conflicto,true);assert.equal(c.state.commitPendiente,false)
   assert.equal(f.datos.has(c.clave+':envio'),false);assert.equal(c.state.item.id,'respuesta-1')
   const borrador=f.datos.get(c.clave+':respuesta-1:0');assert.ok(borrador.includes('No sobrescribir'))
   f.client.rpc=async(n,a)=>n==='admin_revision_siguiente'?{data:null}:original(n,a)
   await c.iniciar();assert.equal(c.state.item,null);assert.equal(c.state.conflicto,false)
   assert.equal(f.datos.get(c.clave+':respuesta-1:0'),borrador)
  }finally{c.destruir()}
 }
})
