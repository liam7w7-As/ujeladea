import {createRequire} from 'node:module'
import {mkdir,writeFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
const require=createRequire(process.env.UJELADEA_UI_PACKAGE_JSON||new URL('../package.json',import.meta.url))
const {chromium}=require('playwright')
const expect=require('playwright/test').expect.configure({timeout:20000})
const base=process.env.UJELADEA_DEMO_URL||'http://127.0.0.1:5180'
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(base))throw Error('Solo se admite la demo local')
const dir='.local-db/joven-ux';await mkdir(dir,{recursive:true})
const meta=await(await fetch(base+'/demo/estado')).json()
const auth=await(await fetch(base+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'admin@demo.local',password:'DemoLocal2026!'})})).json()
async function api(path,body){const r=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+auth.access_token},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.message);return d}
const soc=await api('/rest/v1/sociedades',{nombre:'Prueba UX '+randomUUID().slice(0,8),iglesia:'Datos ficticios'})
const sesion=(await api('/rest/v1/rpc/admin_examen_crear_sesion',{p_etapa:meta.etapa,p_sociedad:soc[0].id,p_participantes:[{nombre:'José Álvarez de prueba'}]})).sesion_id
const browser=await chromium.launch({channel:process.env.UJELADEA_UI_BROWSER||'msedge',headless:true})
const panelContext=await browser.newContext(), jovenContext=await browser.newContext({viewport:{width:390,height:844}})
for(const c of[panelContext,jovenContext])await c.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort())
const panel=await panelContext.newPage(), joven=await jovenContext.newPage()
const checks=[],errores=[],envios=[]
const ok=s=>{checks.push(s);console.log('OK: '+s)}
for(const p of[panel,joven])p.on('pageerror',e=>errores.push(e.message))
const refrescar=p=>p.evaluate(()=>globalThis.window.dispatchEvent(new Event('online')))
async function aprobar(){await panel.reload({waitUntil:'networkidle'});await panel.getByRole('button',{name:'Autorizar acceso',exact:true}).click();await panel.getByLabel('Motivo de la autorización').fill('Identidad comprobada en prueba local de UX');await panel.getByRole('dialog').getByRole('button',{name:'Aceptar',exact:true}).click();await expect(panel.getByRole('dialog')).toHaveCount(0);await refrescar(joven)}
let perder=false,perdida=false
await joven.route('**/rest/v1/rpc/examen_responder',async r=>{envios.push(r.request().postDataJSON());if(perder){perder=false;const response=await r.fetch();if(!response.ok())throw Error('Falló la confirmación en el servidor de prueba');perdida=true;return r.abort('failed')}return r.continue()})
try {
 await panel.goto(base+'/demo/entrar?vista=panel',{waitUntil:'networkidle'});await panel.getByRole('button',{name:'Ingresar a Efesios'}).click()
 await panel.goto(base+'/admin/sesion/'+sesion+'/espera',{waitUntil:'networkidle'})
 await joven.goto(base+'/examen/'+sesion,{waitUntil:'networkidle'})
 await joven.getByLabel('Buscar mi nombre').fill('jose alvarez')
 await expect(joven.getByRole('button',{name:'José Álvarez de prueba',exact:true})).toBeVisible()
 await joven.getByRole('button',{name:'José Álvarez de prueba',exact:true}).click()
 await expect(joven.locator('.joven-identidad')).toContainText('José Álvarez de prueba')
 await joven.screenshot({path:dir+'/registro-movil.png',fullPage:true});ok('búsqueda sin tildes y confirmación visible de identidad')
 await joven.getByRole('button',{name:'Soy yo, confirmar'}).click()
 await expect(joven.getByRole('heading',{name:'Esperando autorización',exact:true})).toBeVisible()
 await expect(joven.getByLabel('Qué ocurrió (opcional)')).toHaveCount(0)
 await expect(joven.getByText('Solicitud recibida. Esperando al moderador.',{exact:true})).toBeVisible()
 ok('el primer ingreso no pide explicar un incidente')
 await aprobar();await expect(joven.getByText('Registro confirmado',{exact:true})).toBeVisible()
 await expect(joven.getByText('45 preguntas',{exact:true})).toBeVisible()
 await joven.getByText('Practicar antes de empezar',{exact:true}).click()
 await joven.getByRole('button',{name:'Ejemplo A',exact:true}).click();await joven.getByRole('button',{name:'Confirmar ejemplo y continuar'}).click()
 await joven.getByLabel('Prueba escribir una respuesta').fill('Texto solo de práctica')
 await joven.getByRole('button',{name:'Finalizar práctica',exact:true}).click()
 await expect(joven.getByRole('heading',{name:'Ya conoces los controles'})).toBeVisible()
 if(envios.length)throw Error('La práctica envió una respuesta real')
 await joven.screenshot({path:dir+'/espera-practica-movil.png',fullPage:true});ok('formato configurado y práctica sin envíos de respuestas reales')
 await panel.getByRole('button',{name:'Iniciar examen',exact:true}).click();await panel.getByRole('dialog').getByRole('button',{name:'Aceptar',exact:true}).click();await expect(panel.getByRole('dialog')).toHaveCount(0);await refrescar(joven)
 await expect(joven.getByText('Pregunta 1 de 45',{exact:true})).toBeVisible()
 await expect(joven.getByRole('progressbar',{name:'Respuestas confirmadas'})).toHaveAttribute('aria-valuenow','0')
 for(const[width,scale]of[[320,100],[390,200],[320,200]]){
  await joven.setViewportSize({width,height:844});await joven.evaluate(s=>{globalThis.document.documentElement.style.fontSize=s+'%'},scale)
  const layout=await joven.evaluate(()=>{
   const reloj=globalThis.document.querySelector('.joven-reloj').getBoundingClientRect(),rango=globalThis.document.createRange()
   rango.selectNodeContents(globalThis.document.querySelector('.joven-cabecera-identidad strong'))
   return{desborda:globalThis.document.documentElement.scrollWidth>globalThis.innerWidth,solapa:Array.from(rango.getClientRects()).some(r=>r.right>reloj.left&&r.left<reloj.right&&r.bottom>reloj.top&&r.top<reloj.bottom)}
  })
  if(layout.desborda||layout.solapa)throw Error('Desbordamiento o solapamiento a '+width+'px y texto '+scale+'%')
 }
 await joven.evaluate(()=>{globalThis.document.documentElement.style.fontSize='100%'});await joven.setViewportSize({width:390,height:844})
 ok('cabecera legible a 320px con texto ampliado al 200%')
 await joven.evaluate(()=>{globalThis.__uxNow=Date.now;Date.now=()=>globalThis.__uxNow()+56*60000})
 await expect(joven.getByText(/Quedan cinco minutos o menos/)).toBeVisible()
 await joven.evaluate(()=>{Date.now=()=>globalThis.__uxNow()+59.5*60000})
 await expect(joven.getByText(/Queda un minuto o menos/)).toBeVisible()
 await joven.evaluate(()=>{Date.now=globalThis.__uxNow;delete globalThis.__uxNow})
 ok('progreso accesible y avisos discretos de cinco minutos y un minuto')
 let escritaProbada=false,contextoVisto=false
 for(let n=1;n<=45;n++){
  await expect(joven.getByText('Pregunta '+n+' de 45',{exact:true})).toBeVisible()
  if(n===20){await joven.reload({waitUntil:'networkidle'});await expect(joven.getByRole('heading',{name:'Volvamos a tu examen'})).toBeVisible();await joven.getByRole('button',{name:'Solicitar autorización',exact:true}).click();await aprobar();await expect(joven.getByText('Pregunta 20 de 45',{exact:true})).toBeVisible();ok('recargar y autorizar retoma la pregunta 20')}
  const opciones=joven.getByRole('group',{name:'Opciones de respuesta'}).getByRole('button')
  if(await opciones.count())await opciones.first().click()
  else {
   const texto=joven.getByRole('textbox',{name:'Tu respuesta',exact:true})
   await texto.fill('Respuesta de prueba '+n+'. Primera explicación.\n\nSegundo párrafo de demostración.')
   if(!escritaProbada){
    await expect(joven.getByText('Borrador sincronizado',{exact:true})).toBeVisible()
    await joven.locator('.joven-menu-ayuda > summary').click();await joven.getByRole('button',{name:'Necesito ayuda'}).click()
    await joven.getByRole('button',{name:'Avisar en el panel del moderador'}).click()
    await expect(joven.getByRole('dialog').getByText(/Solicitud registrada a las/)).toBeVisible()
    await panel.reload({waitUntil:'networkidle'});await expect(panel.getByRole('heading',{name:'Solicitudes de ayuda · 1'})).toBeVisible()
    await panel.getByRole('button',{name:'Marcar atendida'}).click();await expect(panel.getByRole('heading',{name:'Solicitudes de ayuda · 1'})).toHaveCount(0)
    await joven.getByRole('dialog').getByRole('button',{name:'Volver a mi pregunta'}).click()
    await joven.locator('.joven-menu-ayuda > summary').click();ok('solicitud de ayuda visible y atendible en el panel')
    await jovenContext.setOffline(true);await texto.fill('Borrador escrito sin conexión, conservado para continuar.')
    await expect(joven.getByText('Falta sincronizar con el servidor',{exact:true})).toBeVisible()
    await expect(texto).toHaveValue('Borrador escrito sin conexión, conservado para continuar.')
    await jovenContext.setOffline(false);await expect(joven.getByText('Borrador sincronizado',{exact:true})).toBeVisible()
    await expect(texto).toHaveValue('Borrador escrito sin conexión, conservado para continuar.')
    await texto.focus();if(await joven.locator('.joven-siguiente').evaluate(e=>globalThis.getComputedStyle(e).position)!=='static')throw Error('El pie fijo compite con el teclado')
    await joven.setViewportSize({width:390,height:460});await texto.scrollIntoViewIfNeeded();await joven.screenshot({path:dir+'/escritura-viewport-reducido.png',fullPage:true})
    await joven.setViewportSize({width:390,height:844});await joven.evaluate(()=>globalThis.window.scrollTo(0,0));await joven.screenshot({path:dir+'/respuesta-movil.png',fullPage:true})
    escritaProbada=true;ok('borrador sin red se sincroniza al volver y el pie se libera al escribir')
   }
   if(/contexto/i.test(await joven.locator('.joven-enunciado .eyebrow').innerText())){contextoVisto=true;await expect(joven.locator('.joven-pasaje')).toBeVisible();await joven.evaluate(()=>globalThis.window.scrollTo(0,0));await joven.screenshot({path:dir+'/contexto-movil.png',fullPage:true})}
  }
  if(n===2)perder=true
  await joven.getByRole('button',{name:n===45?'Confirmar y finalizar':'Confirmar y continuar',exact:true}).click()
  if(n===2){await expect(joven.getByText('Confirmación pendiente',{exact:true})).toBeVisible();await joven.getByRole('button',{name:'Reintentar confirmación',exact:true}).click();await expect(joven.getByText('Pregunta 3 de 45',{exact:true})).toBeVisible();if(!perdida||envios.at(-1).p_solicitud!==envios.at(-2).p_solicitud)throw Error('El reintento cambió el identificador del envío');ok('una respuesta confirmada con retorno perdido se reintenta con el mismo identificador')}
  if(n===45){await expect(joven.getByRole('dialog',{name:'Entregar evaluación'})).toBeVisible();await joven.getByRole('dialog').getByRole('button',{name:'Confirmar entrega',exact:true}).click()}
 }
 await expect(joven.getByRole('heading',{name:'Tu examen ha finalizado'})).toBeVisible()
 await expect(joven.getByText(/El servidor confirmó 45 de 45 respuestas/)).toBeVisible()
 await expect(joven.getByText('Entrega recibida por el servidor',{exact:true})).toBeVisible()
 await expect(joven.getByText('Hora de registro de la entrega',{exact:true})).toBeVisible()
 await joven.screenshot({path:dir+'/entrega-movil.png',fullPage:true})
 if(!escritaProbada||!contextoVisto)throw Error('Faltó recorrer los tipos de respuesta')
 ok('las 45 preguntas se completan y la constancia muestra el cierre recibido del servidor')
 await joven.reload();await expect(joven.getByRole('heading',{name:'Tu examen ha finalizado'})).toBeVisible()
 await joven.setViewportSize({width:320,height:568})
 if(await joven.evaluate(()=>globalThis.document.documentElement.scrollWidth>globalThis.innerWidth))throw Error('Desbordamiento a 320px')
 ok('constancia persistente y sin desbordamiento a 320px')
 if(errores.length)throw Error('Errores de JavaScript: '+errores.join(' | '))
 await writeFile(dir+'/verificacion.json',JSON.stringify({checks,errores,alcance:'Dos contextos de Edge; DB y Auth de demostración. Sin producción. El viewport reducido no sustituye el teclado de un teléfono físico.'},null,2))
 console.log('Comprobaciones de UX completadas: '+checks.length)
}catch(e){console.error(e.stack);await joven.screenshot({path:dir+'/fallo-joven.png',fullPage:true});await panel.screenshot({path:dir+'/fallo-panel.png',fullPage:true});console.error('Joven: '+(await joven.locator('body').innerText()).slice(-3000));process.exitCode=1}
finally{await browser.close()}
