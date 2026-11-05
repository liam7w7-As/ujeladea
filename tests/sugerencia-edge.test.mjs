import test from 'node:test'
import assert from 'node:assert/strict'
import { crearHandlerSugerencia } from '../supabase/functions/_shared/sugerencia.mjs'

const respuesta='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const propuesta={criterios:[{indice:1,puntos:1,evidencia:'Elemento correcto',justificacion:'Cumple el primer criterio'},{indice:2,puntos:0,evidencia:'',justificacion:'No desarrolla el segundo criterio'}],justificacion:'Revisar la equivalencia con el pastor'}
const generation=(content=propuesta,cost=.001)=>Response.json({model:'modelo-devuelto',usage:{cost},choices:[{finish_reason:'stop',message:{content:JSON.stringify(content)}}]})
function fixture(overrides={}) {
 const llamadas=[],clientes=[]
 const contexto={id:respuesta,texto:'Pregunta de prueba',referencia:'Referencia privada',respuesta:'Texto del alumno',maximo:2,tipo:'abierta',pendiente:true,revision:0,rubrica:[{criterio:'Primer elemento',puntos:1},{criterio:'Segundo elemento',puntos:1}]}
 const opciones={
  url:'https://prueba.supabase.co',publicKey:'clave-publica',serviceKey:'servicio-secreto',providerKey:'solo-servidor',models:['primario','respaldo'],origins:['http://localhost:5173'],
  createClient:(url,key,opts)=>{clientes.push({url,key,opts});return{auth:{getUser:async()=>({data:{user:{app_metadata:{role:'admin'}}},error:null})},rpc:async(nombre,args)=>{
   llamadas.push({nombre,args})
   return {data:nombre==='admin_examen_contexto'?contexto:nombre==='servicio_ia_reservar'?{estado:'reservada',token:'token-reserva'}:{disponible:4.999},error:null}
  }}},
  fetchFn:async(url,opts)=>{llamadas.push({url,body:opts.body?JSON.parse(opts.body):null});return url.endsWith('/key')?Response.json({data:{limit:5,limit_reset:null,limit_remaining:5}}):generation()},
  ...overrides,
 }
 const handler=crearHandlerSugerencia(opciones)
 const request=(body={respuesta_id:respuesta},headers={})=>new Request('http://localhost/functions/v1/sugerir-calificacion',{method:'POST',headers:{authorization:'Bearer jwt',origin:'http://localhost:5173',...headers},body:JSON.stringify(body)})
 return {handler,request,llamadas,contexto,clientes,opciones}
}

test('IA exige JWT validado y rol app_metadata antes de consultar datos o proveedor',async()=>{
 const f=fixture();assert.equal((await f.handler(new Request('http://localhost',{method:'POST'}))).status,401);assert.equal(f.llamadas.length,0)
 for(const user of [{user_metadata:{role:'admin'}},{app_metadata:{role:'joven'}},null]){
  const f=fixture({createClient:()=>({auth:{getUser:async()=>({data:{user},error:null})}})})
  assert.ok([401,403].includes((await f.handler(f.request())).status));assert.equal(f.llamadas.length,0)
 }
})

test('rechaza origen ajeno, payload grande y contexto o puntaje enviados por navegador',async()=>{
 const f=fixture()
 assert.equal((await f.handler(f.request(undefined,{origin:'https://otro.example'}))).status,403)
 assert.equal((await f.handler(f.request({respuesta_id:respuesta,puntaje:2,referencia:'Inyectada'}))).status,400)
 assert.equal((await f.handler(f.request({respuesta_id:'x'.repeat(2500)}))).status,413)
 assert.equal(f.llamadas.length,0)
})

test('propone por criterio con contexto autorizado; usa servicio solo para presupuesto y nunca guarda notas',async()=>{
 const f=fixture(),res=await f.handler(f.request()),dto=await res.json()
 assert.equal(res.status,200);assert.equal(dto.puntaje,1);assert.equal(dto.requiere_revision,true);assert.equal(dto.revision,0)
 assert.equal(JSON.stringify(dto).includes('solo-servidor'),false)
 assert.deepEqual(f.llamadas[0],{nombre:'admin_examen_contexto',args:{p_respuesta:respuesta}})
 assert.equal(f.clientes[0].opts.global.headers.Authorization,'Bearer jwt');assert.equal(f.clientes[1].key,'servicio-secreto')
 const peticion=f.llamadas.find(x=>x.url?.endsWith('/completions')).body
 assert.equal(peticion.response_format.type,'json_schema');assert.equal(peticion.response_format.json_schema.strict,true)
 assert.equal(peticion.provider.require_parameters,true);assert.deepEqual(peticion.provider.max_price,{prompt:2,completion:10,request:0})
 assert.deepEqual(peticion.usage,{include:true})
 assert.equal(peticion.messages[1].content.includes('Referencia privada'),true)
 assert.deepEqual(f.llamadas.filter(x=>x.nombre).map(x=>x.nombre),['admin_examen_contexto','servicio_ia_reservar','servicio_ia_finalizar'])
 assert.equal(f.llamadas.at(-1).args.p_costo,.001)
})

test('sin configuración, con nota revisada o sin presupuesto no hay inferencia',async()=>{
 for(const prop of [{providerKey:''},{serviceKey:''},{models:[]}]) {
  const f=fixture(prop);assert.equal((await f.handler(f.request())).status,503);assert.equal(f.llamadas.length,1)
 }
 const f=fixture();f.contexto.pendiente=false;assert.equal((await f.handler(f.request())).status,409);assert.equal(f.llamadas.length,1)
 for(const estado of ['ocupada','agotado','lista']){
  const f=fixture();const original=f.opciones.createClient
  const handler=crearHandlerSugerencia({...f.opciones,createClient:(...args)=>{
   const c=original(...args),rpc=c.rpc;c.rpc=async(n,a)=>n==='servicio_ia_reservar'?{data:{estado,resultado:propuesta,modelo:'cache',disponible:4},error:null}:rpc(n,a);return c
  }})
  assert.equal((await handler(f.request())).status,{ocupada:409,agotado:402,lista:200}[estado])
  assert.equal(f.llamadas.some(x=>x.url),false)
 }
})

test('rechaza claves sin límite vitalicio de hasta US$5 y libera la reserva sin consumo',async()=>{
 for(const info of [{limit:null,limit_reset:null,limit_remaining:9},{limit:10,limit_reset:null,limit_remaining:9},{limit:5,limit_reset:'daily',limit_remaining:5},{limit:5,limit_reset:null,limit_remaining:0},{limit:5,limit_remaining:5}]){
  let completions=0
  const f=fixture({fetchFn:async(url)=>{if(url.endsWith('/key'))return Response.json({data:info});completions++;return generation()}})
  assert.equal((await f.handler(f.request())).status,503);assert.equal(completions,0);assert.equal(f.llamadas.at(-1).args.p_costo,0)
 }
})

test('descarta criterios repetidos, ausentes, fuera de rango, decimales, JSON roto y salida truncada',async()=>{
 const invalidas=[{...propuesta,criterios:[propuesta.criterios[0],propuesta.criterios[0]]},{...propuesta,criterios:[]},{...propuesta,criterios:[{...propuesta.criterios[0],puntos:99},propuesta.criterios[1]]},{...propuesta,criterios:[{...propuesta.criterios[0],puntos:.5},propuesta.criterios[1]]},'json roto']
 for(const p of invalidas){
  const f=fixture({models:['solo'],fetchFn:async(url)=>url.endsWith('/key')?Response.json({data:{limit:5,limit_reset:null,limit_remaining:5}}):generation(p)})
  assert.equal((await f.handler(f.request())).status,502)
  assert.equal(f.llamadas.at(-1).args.p_resultado,null);assert.equal(f.llamadas.at(-1).args.p_costo,.001)
 }
 const f=fixture({models:['solo'],fetchFn:async(url)=>url.endsWith('/key')?Response.json({data:{limit:5,limit_reset:null,limit_remaining:5}}):Response.json({usage:{cost:.002},choices:[{finish_reason:'length',message:{content:JSON.stringify(propuesta)}}]})})
 assert.equal((await f.handler(f.request())).status,502)
})

test('el respaldo es acotado y cobra también la propuesta inválida; una desconexión carga reserva conservadora',async()=>{
 let intentos=0
 const f=fixture({fetchFn:async(url)=>url.endsWith('/key')?Response.json({data:{limit:5,limit_reset:null,limit_remaining:5}}):(++intentos===1?generation({criterios:[]},.002):generation(propuesta,.003))})
 assert.equal((await f.handler(f.request())).status,200);assert.equal(intentos,2);assert.equal(f.llamadas.at(-1).args.p_costo,.005)
 let n=0
 const sinCosto=fixture({fetchFn:async(url)=>{if(url.endsWith('/key'))return Response.json({data:{limit:5,limit_reset:null,limit_remaining:5}});if(++n===1)throw Error('timeout con posible consumo');return generation()}})
 assert.equal((await sinCosto.handler(sinCosto.request())).status,200);assert.equal(sinCosto.llamadas.at(-1).args.p_costo,null)
})

test('401/402/403 detienen los modelos de respaldo y no filtran errores ni secretos',async()=>{
 for(const status of [401,402,403]){
  let intentos=0
  const f=fixture({fetchFn:async(url)=>{if(url.endsWith('/key'))return Response.json({data:{limit:5,limit_reset:null,limit_remaining:5}});intentos++;return new Response('confidencial solo-servidor',{status})}})
  const res=await f.handler(f.request());assert.equal(res.status,502);assert.equal(intentos,1);assert.equal((await res.text()).includes('confidencial'),false)
 }
})

test('un fallo de liquidación no inicia otra generación; la reserva queda protegida',async()=>{
 const f=fixture();const original=f.opciones.createClient
 const handler=crearHandlerSugerencia({...f.opciones,createClient:(...args)=>{
  const c=original(...args),rpc=c.rpc;c.rpc=(n,a)=>n==='servicio_ia_finalizar'?Promise.resolve({error:{message:'acuse perdido'}}):rpc(n,a);return c
 }})
 assert.equal((await handler(f.request())).status,502)
 assert.equal(f.llamadas.filter(x=>x.url?.endsWith('/completions')).length,1)
})

test('cambiar los modelos aprobados invalida la caché del evaluador anterior',async()=>{
 const f=fixture()
 await f.handler(f.request())
 const otro=crearHandlerSugerencia({...f.opciones,models:['otro-modelo-aprobado']})
 await otro(f.request())
 const versiones=f.llamadas.filter(x=>x.nombre==='servicio_ia_reservar').map(x=>x.args.p_version)
 assert.notEqual(versiones[0],versiones[1])
 assert.ok(versiones.every(v=>v.length<=100))
})
