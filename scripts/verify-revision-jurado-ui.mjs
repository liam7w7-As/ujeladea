import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
const require=createRequire(process.env.UJELADEA_UI_PACKAGE_JSON||new URL('../package.json',import.meta.url))
const {chromium}=require('playwright'),expect=require('playwright/test').expect.configure({timeout:20000})
const base=process.env.UJELADEA_DEMO_URL||'http://127.0.0.1:5181'
if(!/^http:\/\/127\.0\.0\.1:/.test(base))throw Error('Solo demo aislada local')
const dir='.local-db/revision-jurado';await mkdir(dir,{recursive:true})
const meta=await(await fetch(base+'/demo/estado')).json()
const auth=await(await fetch(base+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'admin@demo.local',password:'DemoLocal2026!'})})).json()
async function api(path,body,session=auth,method='POST'){
 const res=await fetch(base+path,{method,headers:{'content-type':'application/json',authorization:'Bearer '+session.access_token},...(body===undefined?{}:{body:JSON.stringify(body)})}),data=await res.json()
 if(!res.ok)throw Error(data.message||data.error||'Error local');return data
}
const rpc=(n,b,s)=>api('/rest/v1/rpc/'+n,b,s)
async function crear(nombre,n){
 const soc=await api('/rest/v1/sociedades',{nombre:nombre+' '+randomUUID().slice(0,5),iglesia:'Demostración aislada'})
 const sesion=(await rpc('admin_examen_crear_sesion',{p_etapa:meta.etapa,p_sociedad:soc[0].id,p_participantes:Array.from({length:n},(_,i)=>({nombre:nombre+' identidad privada '+i}))})).sesion_id
 const alumnos=[]
 for(let i=0;i<n;i++){
  const user=await api('/auth/v1/signup',{})
  const sala=await rpc('examen_sala',{p_sesion:sesion},user)
  const intento=await rpc('examen_registrar',{p_sesion:sesion,p_participante:sala.participantes[0].id},user)
  await rpc('admin_examen_autorizar',{p_intento:intento.intento.id,p_justificacion:'Participante ficticio validado'},auth)
  alumnos.push({user,intento:intento.intento.id})
 }
 await api('/rest/v1/sesiones?id=eq.'+sesion,{estado:'activo'},auth,'PATCH')
 for(const {user,intento} of alumnos){
  let estado=await rpc('examen_contacto',{p_intento:intento},user)
  while(estado.pregunta){const q=estado.pregunta;estado=await rpc('examen_responder',{p_intento:intento,p_pregunta:q.id,p_texto:q.tipo==='multiple'?q.opciones[0]:'Respuesta '+nombre+' de prueba, equivalente a la referencia.',p_solicitud:randomUUID()},user)}
 }
 await api('/rest/v1/sesiones?id=eq.'+sesion,{estado:'finalizado'},auth,'PATCH')
 return sesion
}
const jers=await crear('JERS',2),otra=await crear('OTRA',1)
const resumen=await rpc('admin_revision_resumen',{p_sesion:jers,p_etapa:meta.etapa}),grupo=resumen.preguntas.find(q=>q.total===2)
if(!grupo)throw Error('Falta pregunta compartida en la muestra')
const browser=await chromium.launch({channel:'msedge',headless:true})
const contexts=await Promise.all([1,2].map(()=>browser.newContext({viewport:{width:1440,height:1000}})))
const errores=[],checks=[]
for(const c of contexts)await c.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort())
const [page,otro]=await Promise.all(contexts.map(c=>c.newPage()))
let respuestaActual
page.on('response',async res=>{if(res.url().endsWith('/rpc/admin_revision_siguiente')){try{respuestaActual=await res.json()}catch{/* El transporte puede interrumpirse en esta prueba. */}}})
for(const p of [page,otro])p.on('pageerror',e=>errores.push(e.message))
const ok=s=>{checks.push(s);console.log('OK: '+s)}
const ruta=base+'/admin/sesion/'+jers+'/calificar'
try{
 for(const p of [page,otro])await p.goto(base+'/demo/entrar?vista=panel',{waitUntil:'networkidle'})
 await page.goto(ruta,{waitUntil:'networkidle'})
 await expect(page.getByRole('heading',{name:'Corrección por pregunta'})).toBeVisible()
 await page.getByLabel('Pregunta a revisar').selectOption(grupo.clave)
 await expect(page.locator('.jurado-texto')).toContainText('Respuesta JERS')
 const texto=await page.locator('main').innerText();if(texto.includes('identidad privada')||texto.includes('Respuesta OTRA'))throw Error('Se filtró identidad u otra sociedad')
 if(await page.getByRole('button',{pressed:true}).count())throw Error('Criterios con puntaje predeterminado')
 ok('agrupa solo JERS, oculta identidad y comienza sin puntajes')
 await page.getByRole('button',{name:'Guardar y siguiente',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Marca todos')
 ok('impide guardar criterios incompletos')
 await page.getByRole('group',{name:'Criterio 1',exact:true}).getByRole('button',{name:'Cumple · 1',exact:true}).click()
 await page.getByLabel('Observación del jurado').fill('Borrador que debe recuperarse')
 await expect(page.getByRole('status')).toContainText('Borrador guardado')
 await page.reload({waitUntil:'networkidle'})
 await expect(page.getByLabel('Observación del jurado')).toHaveValue('Borrador que debe recuperarse')
 await expect(page.getByRole('group',{name:'Criterio 1',exact:true}).getByRole('button',{name:'Cumple · 1',exact:true})).toHaveAttribute('aria-pressed','true')
 ok('recupera borrador y criterios tras recargar')
 await otro.goto(ruta,{waitUntil:'networkidle'});await otro.getByLabel('Pregunta a revisar').selectOption(grupo.clave)
 await expect(otro.locator('.jurado-texto')).toContainText('Respuesta JERS')
 const id1=await page.locator('.jurado-respuesta-heading').textContent(),id2=await otro.locator('.jurado-respuesta-heading').textContent()
 if(id1===id2)throw Error('Dos pestañas reservaron la misma respuesta')
 ok('dos jurados corrigen respuestas distintas de la misma pregunta')
 // Libera el segundo jurado para que Guardar y siguiente pueda tomar esa respuesta.
 await otro.getByRole('button',{name:'Volver a resultados'}).click();await expect(otro).toHaveURL(base+'/admin/sesion/'+jers+'/resultados')
 await page.getByRole('button',{name:'Marcar todos como cumplidos'}).click()
 let perder=true
 await page.route('**/rest/v1/rpc/admin_revision_guardar',async route=>{const res=await route.fetch();if(perder){perder=false;await route.abort('failed')}else await route.fulfill({response:res})})
 await page.getByRole('button',{name:'Guardar y siguiente',exact:true}).click()
 await expect(page.getByRole('button',{name:'Reintentar confirmación'})).toBeVisible()
 await expect(page.locator('.jurado-respuesta-heading')).toHaveText(id1)
 await page.getByRole('button',{name:'Reintentar confirmación'}).click()
 await expect(page.locator('.jurado-respuesta-heading')).not.toHaveText(id1)
 const luego=await rpc('admin_revision_resumen',{p_sesion:jers,p_etapa:meta.etapa})
 if(luego.preguntas.find(g=>g.clave===grupo.clave).pendientes!==1)throw Error('La confirmación perdida duplicó la nota')
 ok('acuse perdido conserva la respuesta y reintenta una sola calificación')
 await page.getByText('Dejar esta respuesta para consulta',{exact:true}).click()
 await page.getByLabel('Motivo de consulta (opcional)').fill('Consultar equivalencia pastoral')
 await page.getByRole('button',{name:'Enviar a consulta y seguir'}).click()
 await expect(page.getByRole('heading',{name:'No hay respuestas disponibles en esta cola'})).toBeVisible()
 await page.getByLabel('Cola',{exact:true}).selectOption('consulta')
 await expect(page.getByText('En consulta: Consultar equivalencia pastoral')).toBeVisible()
 ok('consulta deja la respuesta pendiente sin asignar cero')
 await page.getByRole('button',{name:'Pedir propuesta',exact:true}).click();await expect(page.getByRole('alert')).toContainText('autocalificación está desactivada')
 ok('sin IA configurada la corrección manual permanece disponible')
 await page.route('**/functions/v1/sugerir-calificacion',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({respuesta_id:respuestaActual.id,revision:respuestaActual.revision,modelo:'Modelo simulado, sin consumo',requiere_revision:true,disponible_usd:5,criterios:grupo.rubrica.map((_,i)=>({indice:i+1,puntos:i===0?1:0,evidencia:i===0?'Fragmento de ejemplo':'',justificacion:'Propuesta sintética para comprobar la revisión humana'})),justificacion:'El jurado decide la nota.'})}))
 await page.getByRole('button',{name:'Pedir propuesta',exact:true}).click()
 await expect(page.getByRole('button',{name:'Usar propuesta en el borrador'})).toBeVisible()
 if(await page.getByRole('button',{pressed:true}).count())throw Error('La IA aplicó criterios sin aprobación')
 ok('la IA presenta evidencia por criterio sin rellenar ni guardar automáticamente')
 await page.getByRole('button',{name:'Usar propuesta en el borrador'}).click()
 await expect(page.getByRole('group',{name:'Criterio 1',exact:true}).getByRole('button',{name:'Cumple · 1',exact:true})).toHaveAttribute('aria-pressed','true')
 const conPropuesta=await rpc('admin_revision_resumen',{p_sesion:jers,p_etapa:meta.etapa})
 if(conPropuesta.preguntas.find(g=>g.clave===grupo.clave).pendientes!==1)throw Error('Usar propuesta guardó una nota sin confirmación')
 ok('usar propuesta solo modifica el borrador; exige Guardar y siguiente')
 const actual=await page.locator('.jurado-respuesta-heading').textContent()
 await page.getByLabel('Observación del jurado').fill('Ctrl Enter no guarda desde este campo')
 await page.getByLabel('Activar Ctrl + Enter',{exact:false}).check()
 await page.getByLabel('Observación del jurado').press('Control+Enter')
 await expect(page.locator('.jurado-respuesta-heading')).toHaveText(actual)
 ok('el atajo opcional no dispara una nota mientras se escribe')
 await page.screenshot({path:dir+'/jurado-escritorio.png',fullPage:true})
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:dir+'/jurado-movil.png',fullPage:true})
 if(await page.evaluate(()=>globalThis.document.documentElement.scrollWidth>globalThis.innerWidth))throw Error('Desbordamiento en móvil')
 ok('mesa usable sin desbordamiento a 390 px')
 await page.getByRole('button',{name:'Marcar todos como cumplidos'}).click();await page.getByRole('button',{name:'Guardar y siguiente',exact:true}).click()
 await expect(page.getByRole('heading',{name:'No hay respuestas disponibles en esta cola'})).toBeVisible()
 await page.getByLabel('Cola',{exact:true}).selectOption('revisadas')
 await expect(page.getByText(/Segunda revisión · Nota guardada:/)).toBeVisible()
 ok('segunda revisión muestra la nota anterior y requiere nueva confirmación')
 const ajena=await rpc('admin_revision_resumen',{p_sesion:otra,p_etapa:meta.etapa})
 if(ajena.preguntas.some(g=>g.revisadas))throw Error('Se alteraron notas de otra sociedad')
 ok('otras sociedades conservan todas sus respuestas pendientes')
 if(errores.length)throw Error('Errores JavaScript: '+errores.join(' | '))
 await writeFile(dir+'/verificacion-ui.json',JSON.stringify({checks,errores,sesion:jers,otraSociedad:otra,fullSupabaseStack:false,consumoOpenRouter:0},null,2))
 console.log('Comprobaciones completadas: '+checks.length)
}catch(e){console.error(e.message);console.error('Alertas: '+(await otro.getByRole('alert').allTextContents()).join(' | '));console.error((await page.locator('body').innerText()).slice(-2400));await page.screenshot({path:dir+'/fallo.png',fullPage:true});process.exitCode=1}
finally{await browser.close()}
