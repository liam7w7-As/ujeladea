import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as esperar } from 'node:timers/promises'
import { SalaEnVivo } from '../src/lib/sala-en-vivo.js'

function entorno(t,{leer,cada=60000}={}) {
  const ventana=new EventTarget(),documento=new EventTarget()
  ventana.navigator={onLine:true};documento.visibilityState='visible'
  const datos=[],errores=[],conexiones=[]
  let llamadas=0,eliminados=0,status,eventos
  const dto=()=>({sesion:{id:'s',etapa_id:'e'},participantes:[],alertas:[]})
  const canal={on(_,f,cb){eventos=cb;return canal},subscribe(cb){status=cb;return canal}}
  const client={channel:()=>canal,removeChannel:async()=>{eliminados++},rpc:async()=>{llamadas++;return leer?leer(llamadas):{data:dto()}}}
  const control=new SalaEnVivo({client,sesion:'s',etapa:'e',ventana,documento,cada,agrupar:10,onDatos:d=>datos.push(d),onError:e=>errores.push(e),onConexion:s=>conexiones.push(s)})
  t.after(()=>control.destruir())
  return {control,ventana,documento,datos,errores,conexiones,status:s=>status(s),evento:()=>eventos(),llamadas:()=>llamadas,eliminados:()=>eliminados,dto}
}

test('el panel vuelve a leer una foto completa al suscribirse o recuperar la conexión',async t=>{
  const f=entorno(t)
  await f.control.iniciar()
  f.status('CHANNEL_ERROR')
  f.status('SUBSCRIBED')
  await f.control.recargar()
  assert.ok(f.llamadas()>=2)
  assert.equal(f.conexiones.at(-1),'en_vivo')
  assert.equal(f.errores.length,0)
  assert.equal(f.datos.at(-1).sesion.id,'s')
})

test('los errores conservan el último estado y volver a la red recupera los datos',async t=>{
  const f=entorno(t,{leer:n=>n===2?{error:new Error('Sin red')}:{data:{sesion:{id:'s',etapa_id:'e'},participantes:[{id:'p'+n}],alertas:[]}}})
  await f.control.iniciar()
  await f.control.recargar()
  assert.equal(f.datos.at(-1).participantes[0].id,'p1')
  assert.equal(f.errores.length,1)
  f.ventana.dispatchEvent(new Event('online'))
  await f.control.recargar()
  assert.notEqual(f.datos.at(-1).participantes[0].id,'p1')
})

test('la consulta periódica funciona sin Realtime y se suspende con la pestaña oculta',async t=>{
  const f=entorno(t,{cada:20})
  await f.control.iniciar()
  await esperar(35)
  assert.ok(f.llamadas()>=2)
  f.documento.visibilityState='hidden'
  const antes=f.llamadas()
  await esperar(45)
  assert.equal(f.llamadas(),antes)
  f.documento.visibilityState='visible'
  f.documento.dispatchEvent(new Event('visibilitychange'))
  await f.control.recargar()
  assert.ok(f.llamadas()>antes)
})

test('una ráfaga de eventos se agrupa y no provoca una consulta por participante',async t=>{
  const f=entorno(t)
  await f.control.iniciar()
  for(let n=0;n<100;n++)f.evento()
  await esperar(30)
  assert.equal(f.llamadas(),2)
})

test('las lecturas no se solapan y un cambio durante una lectura programa otra foto',async t=>{
  const pendientes=[]
  const f=entorno(t,{leer:()=>new Promise(resolve=>pendientes.push(resolve))})
  const inicio=f.control.iniciar()
  f.evento()
  await esperar(20)
  assert.equal(f.llamadas(),1)
  pendientes[0]({data:f.dto()})
  await esperar(0)
  assert.equal(f.llamadas(),2)
  pendientes[1]({data:{...f.dto(),participantes:[{id:'actualizado'}]}})
  await inicio
  assert.equal(f.datos.at(-1).participantes[0].id,'actualizado')
})

test('al salir se limpian canal y temporizadores y se ignoran respuestas tardías',async t=>{
  let resolver
  const f=entorno(t,{leer:()=>new Promise(resolve=>{resolver=resolve})})
  const inicio=f.control.iniciar()
  f.evento()
  f.control.destruir()
  resolver({data:f.dto()})
  await inicio
  f.status('SUBSCRIBED')
  f.ventana.dispatchEvent(new Event('focus'))
  await esperar(25)
  assert.equal(f.datos.length,0)
  assert.equal(f.llamadas(),1)
  assert.equal(f.eliminados(),1)
})
