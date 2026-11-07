import {createRequire} from 'node:module'
import {mkdir,writeFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
const require=createRequire(process.env.UJELADEA_UI_PACKAGE_JSON||new URL('../package.json',import.meta.url))
const {chromium}=require('playwright'),expect=require('playwright/test').expect.configure({timeout:20000})
const base=process.env.UJELADEA_DEMO_URL||'http://127.0.0.1:5181'
if(!/^http:\/\/127\.0\.0\.1:/.test(base))throw Error('Solo se admite la demo local aislada')
const dir='.local-db/configuracion-sesiones';await mkdir(dir,{recursive:true})
const meta=await(await fetch(base+'/demo/estado')).json()
const auth=await(await fetch(base+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'admin@demo.local',password:'DemoLocal2026!'})})).json()
async function api(path,body){const res=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+auth.access_token},body:JSON.stringify(body)}),data=await res.json();if(!res.ok)throw Error(data.message||data.error);return data}
const nombreSoc='Sesión normal '+randomUUID().slice(0,7),soc=(await api('/rest/v1/sociedades',{nombre:nombreSoc,iglesia:'Datos ficticios'}))[0]
const nombrePC='Dispositivo PC '+nombreSoc.slice(-7),nombreCelular='Dispositivo celular '+nombreSoc.slice(-7)
const browser=await chromium.launch({channel:'msedge',headless:true})
const contexts=await Promise.all([1,2,3].map((_,i)=>browser.newContext({viewport:i===2?{width:390,height:844}:{width:1440,height:1000}})))
for(const c of contexts)await c.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort())
const [panel,pc,celular]=await Promise.all(contexts.map(c=>c.newPage())),errores=[],checks=[]
for(const p of [panel,pc,celular])p.on('pageerror',e=>errores.push(e.message))
const ok=s=>{checks.push(s);console.log('OK: '+s)}
async function aprobar(nombre){await panel.reload({waitUntil:'networkidle'});const fila=panel.locator('.participante-control').filter({has:panel.getByRole('heading',{name:nombre,exact:true})});await fila.getByRole('button',{name:'Autorizar acceso',exact:true}).click();await panel.getByLabel('Motivo de la autorización').fill('Persona comprobada para el ensayo local');await panel.getByRole('dialog').getByRole('button',{name:'Aceptar',exact:true}).click();await expect(panel.getByRole('dialog')).toHaveCount(0)}
try{
 await panel.goto(base+'/demo/entrar?vista=panel',{waitUntil:'networkidle'});await panel.goto(base+'/admin/sesion/nueva',{waitUntil:'networkidle'})
 await panel.getByPlaceholder('Buscar sociedad o iglesia...').fill(nombreSoc);await panel.getByText(nombreSoc,{exact:true}).click()
 for(const nombre of [nombrePC,nombreCelular]){await panel.getByPlaceholder('Nombre del participante...').fill(nombre);await panel.getByRole('button',{name:'Agregar participante',exact:true}).click()}
 await panel.getByRole('button',{name:'Continuar',exact:true}).click()
 await expect(panel.getByLabel('Duración en minutos')).toHaveValue('60');await expect(panel.getByLabel('Preguntas por joven')).toHaveValue('45')
 await panel.getByLabel('Duración en minutos').fill('3');await panel.getByLabel('Preguntas por joven').fill('6')
 await expect(panel.getByText('6 preguntas: 4 múltiples · 1 abiertas · 1 de contexto.')).toBeVisible()
 if((await panel.locator('body').innerText()).includes('Sesión de prueba'))throw Error('Se añadió una modalidad no solicitada')
 await panel.screenshot({path:dir+'/configuracion.png',fullPage:true});ok('minutos y preguntas editables por sesión normal; predeterminados 60/45')
 const respuesta=panel.waitForResponse(r=>r.url().endsWith('/rpc/admin_sesion_crear'))
 await panel.getByRole('button',{name:'Crear y Generar QR'}).click();const data=await(await respuesta).json(),id=data.sesion_id
 await expect(panel.getByRole('heading',{name:'Sala de control'})).toBeVisible()
 await expect(panel.getByRole('dialog',{name:'Acceso a la sesión'})).toBeVisible()
 await panel.getByRole('dialog').getByRole('button',{name:'Aceptar',exact:true}).click()
 ok('crea la sesión normal y su QR con seis preguntas y tres minutos')
 for(const [p,nombre] of [[pc,nombrePC],[celular,nombreCelular]]){await p.goto(base+'/examen/'+id,{waitUntil:'networkidle'});await p.getByRole('button',{name:nombre,exact:true}).click();await p.getByRole('button',{name:'Soy yo, confirmar',exact:true}).click();await expect(p.getByRole('heading',{name:'Esperando autorización'})).toBeVisible();await aprobar(nombre);await p.evaluate(()=>globalThis.window.dispatchEvent(new Event('online')));await expect(p.getByText('Registro confirmado',{exact:true})).toBeVisible();await expect(p.getByText('6 preguntas',{exact:true})).toBeVisible()}
 ok('PC y celular simulado recorren el registro y la autorización normales con seis preguntas')
 await panel.getByRole('button',{name:'Iniciar examen',exact:true}).click();await panel.getByRole('dialog').getByRole('button',{name:'Aceptar',exact:true}).click()
 for(const p of [pc,celular]){await p.evaluate(()=>globalThis.window.dispatchEvent(new Event('online')));await expect(p.getByText('Pregunta 1 de 6',{exact:true})).toBeVisible()}
 await celular.screenshot({path:dir+'/celular.png',fullPage:true});if(await celular.evaluate(()=>globalThis.document.documentElement.scrollWidth>globalThis.innerWidth))throw Error('Desbordamiento en celular')
 ok('ambos empiezan con contador 1 de 6; móvil sin desbordamiento')
 for(const p of [pc,celular])for(let i=1;i<=6;i++){
  await expect(p.getByText('Pregunta '+i+' de 6',{exact:true})).toBeVisible()
  const opciones=p.getByRole('group',{name:'Opciones de respuesta'}).getByRole('button')
  if(await opciones.count())await opciones.first().click();else await p.getByRole('textbox',{name:'Tu respuesta'}).fill('Respuesta sintética para comprobar el flujo normal completo.')
  await p.getByRole('button',{name:i===6?'Confirmar y finalizar':'Confirmar y continuar'}).click()
  if(i===6)await p.getByRole('dialog').getByRole('button',{name:'Confirmar entrega',exact:true}).click()
 }
 for(const p of [pc,celular])await expect(p.getByRole('heading',{name:'Tu examen ha finalizado'})).toBeVisible()
 ok('los dos completan seis respuestas y llegan a la entrega final normal')
 await panel.getByRole('button',{name:'Finalizar para todos'}).click();await panel.getByRole('dialog').getByRole('button',{name:'Aceptar',exact:true}).click()
 await panel.goto(base+'/admin/dashboard',{waitUntil:'networkidle'})
 const tarjeta=panel.locator('article.etapa-session').filter({has:panel.getByRole('heading',{name:nombreSoc,exact:true})})
 await expect(tarjeta).toContainText('6 preguntas · 3 min');await tarjeta.getByRole('button',{name:'Eliminar sesión',exact:true}).click()
 await expect(panel.getByRole('dialog').getByRole('button',{name:'Confirmar eliminación'})).toBeDisabled()
 await panel.getByLabel('Escribe ELIMINAR para confirmar').fill('ELIMINAR');await panel.getByRole('dialog').getByRole('button',{name:'Confirmar eliminación'}).click()
 await expect(panel.getByRole('dialog')).toHaveCount(0);await expect(tarjeta).toHaveCount(0)
 ok('elimina la sesión mediante confirmación y desaparece del panel')
 await panel.goto(base+'/admin/ranking',{waitUntil:'networkidle'});await expect(panel.getByRole('heading',{name:'Rendimiento de sociedades'})).toBeVisible();await expect(panel.getByText(nombreSoc,{exact:true})).toHaveCount(0)
 await panel.goto(base+'/admin/premiacion',{waitUntil:'networkidle'});if((await panel.locator('body').innerText()).includes(nombrePC))throw Error('La sesión eliminada sigue en premiación')
 ok('los resultados eliminados dejan de aparecer en ranking y premiación')
 const nuevo=(await api('/rest/v1/rpc/admin_sesion_crear',{p_etapa:meta.etapa,p_sociedad:soc.id,p_participantes:[{nombre:nombrePC}],p_minutos:1,p_cantidad:3})).sesion_id
 await pc.goto(base+'/examen/'+nuevo,{waitUntil:'networkidle'});await pc.getByRole('button',{name:nombrePC,exact:true}).click();await pc.getByRole('button',{name:'Soy yo, confirmar',exact:true}).click();await expect(pc.getByRole('heading',{name:'Esperando autorización'})).toBeVisible()
 await api('/rest/v1/rpc/admin_sesion_eliminar',{p_sesion:nuevo,p_etapa:meta.etapa,p_confirmacion:'ELIMINAR'})
 ok('reutiliza el mismo nombre, sociedad y dispositivo después de eliminar')
 if(errores.length)throw Error(errores.join(' | '))
 await writeFile(dir+'/verificacion.json',JSON.stringify({checks,errores,fullSupabaseStack:false,dispositivos:'Un navegador de escritorio y otro con viewport móvil; los dispositivos físicos los probará el administrador'},null,2))
 console.log('Comprobaciones completadas: '+checks.length)
}catch(e){console.error(e.message);console.error((await panel.locator('body').innerText()).slice(-1600));await panel.screenshot({path:dir+'/fallo.png',fullPage:true});process.exitCode=1}
finally{await browser.close()}
