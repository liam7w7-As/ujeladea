import test from 'node:test'
import assert from 'node:assert/strict'
import { crearHandlerSugerencia } from '../supabase/functions/_shared/sugerencia.mjs'

const respuesta='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
function fixture(overrides={}) {
  const llamadas=[]
  const contexto={id:respuesta,texto:'Pregunta de prueba',referencia:'Referencia privada',respuesta:'Texto del alumno',maximo:10,tipo:'abierta',pendiente:true}
  const opciones={
    url:'https://prueba.supabase.co',publicKey:'clave-publica',providerKey:'solo-servidor',model:'modelo-configurado',origins:['http://localhost:5173'],
    createClient:()=>({auth:{getUser:async()=>({data:{user:{app_metadata:{role:'admin'}}},error:null})},rpc:async(nombre,args)=>{llamadas.push({nombre,args});return{data:contexto,error:null}}}),
    fetchFn:async(url,opts)=>{llamadas.push({url,body:JSON.parse(opts.body)});return Response.json({choices:[{message:{content:JSON.stringify({puntaje:6,justificacion:'Sugerencia para revisión'})}}]})},
    ...overrides,
  }
  const handler=crearHandlerSugerencia(opciones)
  const request=(body={respuesta_id:respuesta},headers={})=>new Request('http://localhost/functions/v1/sugerir-calificacion',{method:'POST',headers:{authorization:'Bearer jwt',origin:'http://localhost:5173',...headers},body:JSON.stringify(body)})
  return{handler,request,llamadas,contexto}
}
test('la IA exige JWT validado y rol de app_metadata antes de consultar datos o proveedor',async()=>{
  const sinToken=fixture()
  assert.equal((await sinToken.handler(new Request('http://localhost',{method:'POST'}))).status,401)
  assert.equal(sinToken.llamadas.length,0)
  for(const user of [{user_metadata:{role:'admin'}},{app_metadata:{role:'joven'}},null]){
    const f=fixture({createClient:()=>({auth:{getUser:async()=>({data:{user},error:null})}})})
    assert.ok([401,403].includes((await f.handler(f.request())).status))
    assert.equal(f.llamadas.length,0)
  }
})
test('rechaza origen ajeno y no acepta preguntas ni puntajes enviados por el navegador',async()=>{
  const f=fixture()
  assert.equal((await f.handler(f.request(undefined,{origin:'https://otro.example'}))).status,403)
  assert.equal((await f.handler(f.request({respuesta_id:respuesta,puntaje:10,referencia:'Inyectada'}))).status,400)
  assert.equal(f.llamadas.length,0)
})
test('consulta contexto con el JWT del administrador, propone una nota acotada y no escribe calificaciones',async()=>{
  const f=fixture()
  const result=await f.handler(f.request())
  assert.equal(result.status,200)
  const dto=await result.json()
  assert.equal(dto.requiere_revision,true)
  assert.equal(dto.puntaje,6)
  assert.equal(JSON.stringify(dto).includes('solo-servidor'),false)
  assert.deepEqual(f.llamadas[0],{nombre:'admin_examen_contexto',args:{p_respuesta:respuesta}})
  assert.equal(f.llamadas.length,2)
  assert.equal(f.llamadas[1].body.messages[1].content.includes('Referencia privada'),true)
})
test('una respuesta ya calificada y una IA sin configuración no generan consumo externo',async()=>{
  const f=fixture()
  f.contexto.pendiente=false
  assert.equal((await f.handler(f.request())).status,409)
  assert.equal(f.llamadas.length,1)
  const manual=fixture({providerKey:''})
  assert.equal((await manual.handler(manual.request())).status,503)
  assert.equal(manual.llamadas.length,1)
})
test('descarta puntajes fuera de rango, decimales, JSON inválido y errores del proveedor sin filtrar su contenido',async()=>{
  for(const content of ['no es JSON',JSON.stringify({puntaje:99,justificacion:'X'}),JSON.stringify({puntaje:2.5,justificacion:'X'})]){
    const f=fixture({fetchFn:async()=>Response.json({choices:[{message:{content}}]})})
    assert.equal((await f.handler(f.request())).status,502)
  }
  const f=fixture({fetchFn:async()=>new Response('error confidencial solo-servidor',{status:429})})
  const result=await f.handler(f.request())
  assert.equal(result.status,502)
  assert.equal((await result.text()).includes('confidencial'),false)
})
