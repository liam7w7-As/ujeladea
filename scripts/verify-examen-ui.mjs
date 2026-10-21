import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'vite'
import { adminClaims, createTestDatabase, applyMigrations, ident } from './lib/local-database.mjs'

const require=createRequire(process.env.UJELADEA_UI_PACKAGE_JSON || new URL('../package.json',import.meta.url))
const { chromium }=require('playwright')
const expect=require('playwright/test').expect.configure({timeout:25000})
const dir='.local-db/examen-ui'
await mkdir(dir,{recursive:true})
const db=await createTestDatabase()
await applyMigrations(db)
const uid=randomUUID(), uid2=randomUUID(), sociedad=randomUUID()
await db.query('INSERT INTO auth.users(id) VALUES($1),($2),($3)',[uid,uid2,adminClaims.sub])
async function como(claims,fn) {
  return db.transaction(async tx=>{
    await tx.exec('SET LOCAL ROLE authenticated')
    await tx.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify(claims)])
    return fn(tx)
  })
}
async function rpc(nombre,args,claims={sub:uid}) {
  const keys=Object.keys(args)
  return como(claims,async tx=>(await tx.query('SELECT public.'+ident(nombre)+'('+keys.map((k,i)=>ident(k)+' => $'+(i+1)).join(',')+') dato',keys.map(k=>typeof args[k]==='object'?JSON.stringify(args[k]):args[k]))).rows[0].dato)
}
const etapa=(await db.query("SELECT id FROM public.etapas WHERE libro='Efesios'")).rows[0].id
await como(adminClaims,async tx=>{
  await tx.query('UPDATE public.etapas SET cantidad_preguntas=25,reglas=\'{"version":2}\'::jsonb WHERE id=$1',[etapa])
  await tx.query("INSERT INTO public.sociedades(id,nombre,iglesia) VALUES($1,'Sociedad de prueba','Iglesia de prueba')",[sociedad])
  for(let k=1;k<=25;k++)await tx.query("INSERT INTO public.preguntas(etapa_id,tipo,texto,respuesta_correcta,puntaje) VALUES($1,'abierta',$2,'Referencia privada para el jurado',10)",[etapa,'Pregunta de prueba de Efesios '+k])
  await tx.query("UPDATE public.etapas SET estado='activa' WHERE id=$1",[etapa])
})
const sesion=(await rpc('admin_examen_crear_sesion',{p_etapa:etapa,p_sociedad:sociedad,p_participantes:[{nombre:'Joven de prueba',del_censo:true}]},adminClaims)).sesion_id
const checks=[], errores=[], directas=[], modulos=[]
let offline=false, perderConfirmacion=false, browser, server, intento
function ok(nombre,condicion=true){if(!condicion)throw new Error(nombre);checks.push(nombre);console.log('OK:',nombre)}
function claimsRequest(req) {
 try{return JSON.parse(Buffer.from(req.headers().authorization.split(' ')[1].split('.')[1],'base64url').toString())}catch{return {}}
}
function sesionAuth(admin=false) {
 const now=Math.floor(Date.now()/1000)
 const claims={sub:admin?adminClaims.sub:uid,role:'authenticated',exp:now+3600,iat:now,app_metadata:admin?{role:'admin'}:{},is_anonymous:!admin}
 return {access_token:[{alg:'HS256',typ:'JWT'},claims].map(o=>Buffer.from(JSON.stringify(o)).toString('base64url')).join('.')+'.firma-simulada',refresh_token:'solo-ui',expires_at:now+3600,expires_in:3600,token_type:'bearer',
 user:{id:claims.sub,aud:'authenticated',role:'authenticated',is_anonymous:!admin,email:admin?'admin@prueba.local':undefined,app_metadata:claims.app_metadata,created_at:new Date().toISOString()}}
}
async function simular(context) {
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort())
 await context.route('http://127.0.0.1:54329/**',async route=>{
  const req=route.request(), url=new URL(req.url()), method=req.method()
  const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-expose-headers':'content-range'}
  const json=(data,status=200,extra={})=>route.fulfill({status,contentType:'application/json',headers:{...headers,...extra},body:JSON.stringify(data)})
  if(method==='OPTIONS')return route.fulfill({status:204,headers})
  if(url.pathname.startsWith('/auth/v1/')){
    if(url.pathname.endsWith('/logout'))return json({})
    return json(sesionAuth(url.pathname.endsWith('/token')))
  }
  if(offline)return route.abort('failed')
  try{
    if(url.pathname.startsWith('/rest/v1/rpc/')){
      const nombre=url.pathname.split('/').at(-1)
      if(!/^(?:admin_)?examen_[a-z_]+$/.test(nombre))return json({message:'RPC desconocida'},404)
      const data=await rpc(nombre,req.postDataJSON() || {},claimsRequest(req))
      if(nombre==='examen_responder'&&perderConfirmacion){perderConfirmacion=false;return route.abort('failed')}
      return json(data)
    }
    const tabla=url.pathname.split('/').at(-1)
    if(!/^[a-z_]+$/.test(tabla))return json({message:'Tabla inválida'},400)
    const claims=claimsRequest(req)
    if(claims.app_metadata?.role!=='admin')directas.push(tabla)
    const valores=[], condiciones=[]
    for(const[k,v]of url.searchParams){
      if(['select','order','limit','offset'].includes(k))continue
      if(!/^[a-z_]+$/.test(k))continue
      if(v.startsWith('eq.')){valores.push(v.slice(3));condiciones.push(ident(k)+'=$'+valores.length)}
      else if(v.startsWith('in.(')){const ids=v.slice(4,-1).split(',');const ps=ids.map(id=>{valores.push(id);return '$'+valores.length});condiciones.push(ident(k)+' IN ('+ps.join(',')+')')}
    }
    const where=condiciones.length?' WHERE '+condiciones.join(' AND '):''
    if(!['GET','HEAD'].includes(method))return json({message:'Mutación directa no simulada'},400)
    const order=url.searchParams.get('order')?.split('.')[0] || 'id'
    const offset=Math.max(0,Number(url.searchParams.get('offset')||0)),limit=Math.min(5000,Math.max(0,Number(url.searchParams.get('limit')||1000)))
    const rows=await como(claims,async tx=>(await tx.query('SELECT * FROM public.'+ident(tabla)+where+' ORDER BY '+ident(order)+' OFFSET '+offset+' LIMIT '+limit,valores)).rows)
    if(method==='HEAD')return route.fulfill({status:200,headers:{...headers,'content-range':'0-'+Math.max(0,rows.length-1)+'/'+rows.length}})
    if(req.headers().accept?.includes('application/vnd.pgrst.object+json'))return rows.length===1?json(rows[0]):json({message:'No se encontró el registro',code:'PGRST116'},406)
    return json(rows)
  }catch(error){return json({code:error.code,message:error.message},400)}
 })
}
try{
 process.env.VITE_SUPABASE_URL='http://127.0.0.1:54329'
 process.env.VITE_SUPABASE_PUBLISHABLE_KEY='sb_publishable_ui_fixture_only'
 server=await createServer({server:{host:'127.0.0.1',port:4174,strictPort:true},logLevel:'error'})
 await server.listen()
 browser=await chromium.launch({channel:process.env.UJELADEA_UI_BROWSER || 'msedge',headless:true})
 const context=await browser.newContext({viewport:{width:1440,height:1000}})
 await simular(context)
 const page=await context.newPage()
 page.on('pageerror',err=>errores.push(err.message))
 page.on('request',req=>{if(req.resourceType()==='script')modulos.push(req.url())})
 await page.goto('http://127.0.0.1:4174/examen/'+sesion)
 await page.getByRole('button',{name:'Joven de prueba',exact:true}).click()
 await page.getByRole('button',{name:'Soy yo, confirmar'}).click()
 await expect(page.getByRole('heading',{name:'Esperando al encargado'})).toBeVisible()
 intento=(await db.query('SELECT id FROM public.intentos')).rows[0].id
 ok('registro y espera usan RPC autenticadas')
 await expect(page.getByRole('region',{name:'Instrucciones del examen'})).toBeVisible()
 await expect(page.getByText('25 preguntas',{exact:true})).toBeVisible()
 await page.setViewportSize({width:390,height:844})
 await page.screenshot({path:dir+'/espera-instrucciones-movil.png',fullPage:true})
 ok('la espera explica guardado, tiempo y recuperación con la cantidad configurada',await page.evaluate(()=>globalThis.document.documentElement.scrollWidth<=globalThis.innerWidth))
 await page.setViewportSize({width:1440,height:1000})
 await como(adminClaims,tx=>tx.query("UPDATE public.sesiones SET estado='activo' WHERE id=$1",[sesion]))
 await expect(page.getByText('Pregunta 1 de 25',{exact:true})).toBeVisible()
 const asignadas=(await db.query('SELECT id FROM public.intento_preguntas WHERE intento_id=$1 ORDER BY posicion',[intento])).rows
 for(const q of asignadas.slice(0,19))await rpc('examen_responder',{p_intento:intento,p_pregunta:q.id,p_texto:'Respuesta confirmada de prueba',p_solicitud:randomUUID()})
 await page.reload()
 await expect(page.getByText('Pregunta 20 de 25',{exact:true})).toBeVisible()
 ok('recargar recupera la pregunta 20 sin contar filas locales')
 const texto=page.getByRole('textbox',{name:'Tu respuesta'})
 await texto.fill('Borrador conservado en la pregunta veinte')
 await expect(page.getByText('Borrador guardado en el servidor.',{exact:true})).toBeVisible()
 await page.evaluate(()=>globalThis.document.dispatchEvent(new Event('fullscreenchange')))
 await expect(page.getByRole('heading',{name:'Vuelve al examen'})).toBeVisible()
 await page.getByRole('button',{name:'Continuar mi examen'}).click()
 await expect(texto).toHaveValue('Borrador conservado en la pregunta veinte')
 await expect(page.getByText('Pregunta 20 de 25',{exact:true})).toBeVisible()
 ok('una alerta no reinicia la pregunta ni borra el texto')
 await page.screenshot({path:dir+'/pregunta-20-escritorio.png',fullPage:true})
 await page.reload()
 await expect(texto).toHaveValue('Borrador conservado en la pregunta veinte')
 await expect(page.getByText('Pregunta 20 de 25',{exact:true})).toBeVisible()
 ok('recarga conserva el borrador y el orden asignado')
 await page.getByText('Ayuda para responder y guardar',{exact:true}).click()
 await expect(page.getByRole('heading',{name:'Comprueba el guardado'})).toBeVisible()
 await expect(texto).toHaveValue('Borrador conservado en la pregunta veinte')
 await expect(page.getByText('Pregunta 20 de 25',{exact:true})).toBeVisible()
 await page.getByText('Ayuda para responder y guardar',{exact:true}).click()
 ok('consultar la ayuda no remonta la pregunta ni sustituye el borrador')
 ok('el examen del joven no descarga generadores de PDF ni pantallas administrativas',!modulos.some(url=>/\/src\/lib\/pdf|jspdf|\/src\/pages\/admin\//i.test(url)))
 perderConfirmacion=true
 await page.getByRole('button',{name:'Confirmar y continuar'}).click()
 await expect(page.getByText('La confirmación está pendiente. Reintentaremos el mismo envío al conectar.',{exact:true})).toBeVisible()
 await expect(texto).toBeDisabled()
 await page.getByRole('button',{name:'Reintentar confirmación',exact:true}).click()
 await expect(page.getByText('Pregunta 21 de 25',{exact:true})).toBeVisible()
 ok('perder la confirmación y reintentar produce una sola respuesta',(await db.query('SELECT count(*)::int n FROM public.respuestas')).rows[0].n===20)
 offline=true
 await texto.fill('Texto escrito sin conexión')
 await expect(page.getByText('No pudimos sincronizar. Tu texto sigue en este dispositivo.',{exact:true})).toBeVisible()
 offline=false
 await page.reload()
 await expect(texto).toHaveValue('Texto escrito sin conexión')
 await expect(page.getByText('Borrador guardado en el servidor.',{exact:true})).toBeVisible()
 ok('un borrador sin conexión se recupera y sincroniza al regresar')
 // Un cambio remoto entre edición y envío debe pedir una decisión explícita.
 await texto.fill('Versión local pendiente')
 const actual=await rpc('examen_estado',{p_intento:intento})
 await rpc('examen_borrador',{p_intento:intento,p_pregunta:actual.pregunta.id,p_texto:'Versión de otra pestaña',p_revision:actual.pregunta.revision})
 await expect(page.getByText('Hay otro borrador en el servidor. Elige cuál conservar antes de continuar.',{exact:true})).toBeVisible()
 await expect(texto).toHaveValue('Versión local pendiente')
 await page.getByRole('button',{name:'Usar el borrador del servidor'}).click()
 await expect(texto).toHaveValue('Versión de otra pestaña')
 ok('el conflicto entre pestañas conserva texto y exige elegir')
 await page.setViewportSize({width:390,height:844})
 await page.screenshot({path:dir+'/pregunta-21-movil.png',fullPage:true})
 ok('el examen móvil no tiene desbordamiento horizontal',await page.evaluate(()=>globalThis.document.documentElement.scrollWidth<=globalThis.innerWidth))
 const json=JSON.stringify(await rpc('examen_estado',{p_intento:intento}))
 ok('el DTO del participante no incluye claves de corrección ni puntajes obtenidos',!json.includes('respuesta_correcta')&&!json.includes('puntaje_obtenido')&&!json.includes('Referencia privada'))
 await db.query("UPDATE public.intentos SET vence_at=clock_timestamp()-interval '1 second' WHERE id=$1",[intento])
 await db.query("UPDATE public.intento_preguntas SET borrador_at=clock_timestamp()-interval '2 seconds' WHERE id=$1",[actual.pregunta.id])
 await expect(page.getByRole('heading',{name:'Tu examen ha finalizado'})).toBeVisible()
 await expect(page.getByText(/El servidor confirmó 21 de 25 respuestas/)).toBeVisible()
 ok('al vencer conserva el borrador recibido a tiempo y confirma la cantidad real')
 await page.reload()
 await expect(page.getByRole('heading',{name:'Tu examen ha finalizado'})).toBeVisible()
 ok('la confirmación final se mantiene después de recargar')
 await expect.poll(async () => (await db.query('SELECT count(*)::int n FROM public.eventos_sesion WHERE intento_id=$1',[intento])).rows[0].n).toBeGreaterThan(0)
 ok('la alerta llega a la API y queda registrada en el servidor local')
 ok('el participante nunca consulta tablas directamente',directas.length===0)
 // Sesión administrativa independiente en el mismo navegador.
 await page.setViewportSize({width:1440,height:1000})
 await page.goto('http://127.0.0.1:4174/admin/login')
 await page.getByLabel('Correo electrónico').fill('admin@prueba.local')
 await page.getByLabel('Contraseña').fill('clave-simulada')
 await page.getByRole('button',{name:'Ingresar al panel'}).click()
 await page.getByRole('button',{name:'Ingresar a Efesios'}).click()
 await page.goto('http://127.0.0.1:4174/admin/sesion/'+sesion+'/calificar')
 await expect(page.getByRole('heading',{name:'Calificar respuestas'})).toBeVisible()
 await page.getByRole('spinbutton',{name:'Puntaje del jurado'}).first().fill('7')
 await page.getByRole('button',{name:'Guardar calificación'}).first().click()
 await expect(page.getByText('20 pendientes',{exact:true})).toBeVisible()
 ok('el jurado guarda la calificación mediante RPC y actualiza la suma',(await db.query('SELECT puntaje_total FROM public.participantes WHERE id=(SELECT participante_id FROM public.intentos WHERE id=$1)',[intento])).rows[0].puntaje_total===7)
 await page.goto('http://127.0.0.1:4174/examen/'+sesion+'/finalizado')
 await expect(page.getByRole('heading',{name:'Tu examen ha finalizado'})).toBeVisible()
 ok('iniciar sesión como administrador no reemplaza la identidad del participante')
 await como(adminClaims,tx=>tx.query("UPDATE public.sesiones SET estado='finalizado' WHERE id=$1",[sesion]))
 await page.goto('http://127.0.0.1:4174/admin/ranking')
 await expect(page.getByRole('button',{name:'Informe para el jurado'})).toBeEnabled()
 const [informePdf]=await Promise.all([page.waitForEvent('popup'),page.getByRole('button',{name:'Informe para el jurado'}).click()])
 await informePdf.waitForURL(/^blob:/)
 const pdfBytes=await page.evaluate(async url=>Array.from(new Uint8Array(await (await fetch(url)).arrayBuffer())),informePdf.url())
 await writeFile(dir+'/informe-efesios-ui.pdf',Buffer.from(pdfBytes))
 await informePdf.close()
 ok('el jurado exporta el informe V2 con notas pendientes y todas las asignaciones',Buffer.from(pdfBytes).subarray(0,4).toString()==='%PDF')
 await page.goto('http://127.0.0.1:4174/admin/preguntas')
 await expect(page.getByText('El banco y las rúbricas están fijos durante la evaluación.',{exact:true})).toBeVisible()
 ok('la base del banco explica los tres tipos de pregunta y la revisión pastoral')

 ok('sin errores de ejecución de React',errores.length===0)
 await writeFile(dir+'/informe.json',JSON.stringify({alcance:'UI de React con Auth y REST simulados; RPC, RLS y datos en PostgreSQL 17 local PGlite. Sin producción ni IA externa.',checks,errores},null,2))
 console.log(JSON.stringify({checks:checks.length,errores,capturas:dir}))
}catch(error){
 console.error(error.stack)
 const page=browser?.contexts()[0]?.pages()[0]
 if(page){await page.screenshot({path:dir+'/fallo.png',fullPage:true});console.error((await page.locator('body').innerText()).slice(0,4500))}
 process.exitCode=1
}finally{await browser?.close();await server?.close();await db.close()}
