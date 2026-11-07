import {createRequire} from 'node:module'
import {mkdir,writeFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
const require=createRequire(process.env.UJELADEA_UI_PACKAGE_JSON||new URL('../package.json',import.meta.url)),{chromium}=require('playwright'),expect=require('playwright/test').expect.configure({timeout:25000})
const base=process.env.UJELADEA_DEMO_URL||'http://127.0.0.1:5185'
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(base))throw Error('Solo se admite la demo local aislada')
const dir='.local-db/supervision-ui';await mkdir(dir,{recursive:true})
const meta=await(await fetch(base+'/demo/estado')).json(),auth=await(await fetch(base+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'admin@demo.local',password:'DemoLocal2026!'})})).json()
async function api(path,body,headers={},method='POST'){const r=await fetch(base+path,{method,headers:{'content-type':'application/json',authorization:'Bearer '+auth.access_token,...headers},body:JSON.stringify(body)}),d=await r.json();if(!r.ok)throw Error(d.message||'Error local');return d}
const sociedad=(await api('/rest/v1/sociedades',{nombre:'Supervisión '+randomUUID().slice(0,8),iglesia:'Datos ficticios'}))[0],nombre='Participante de revisión',sid=(await api('/rest/v1/rpc/admin_sesion_crear',{p_etapa:meta.etapa,p_sociedad:sociedad.id,p_participantes:[{nombre}],p_minutos:60,p_cantidad:25})).sesion_id
const b=await chromium.launch({channel:'msedge',headless:true}),checks=[],errores=[];const ok=s=>{checks.push(s);console.log('OK: '+s)}
try{
 const ctx=await b.newContext({viewport:{width:1280,height:900}});await ctx.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort())
 // Cambios controlados de las señales que entrega el navegador; no simula un SO Android real.
 await ctx.addInitScript(()=>{globalThis.__focoExamen=true;Object.defineProperty(globalThis.Document.prototype,'hasFocus',{value:()=>globalThis.__focoExamen})})
 const p=await ctx.newPage();p.on('pageerror',e=>errores.push(e.message));let instancia
 p.on('request',r=>{if(r.url().includes('/rpc/examen_'))instancia=r.headers()['x-examen-instancia']||instancia})
 await p.goto(base+'/examen/'+sid,{waitUntil:'networkidle'});await p.getByRole('button',{name:nombre,exact:true}).click()
 const registrado=p.waitForResponse(r=>r.url().endsWith('/rpc/examen_registrar'));await p.getByRole('button',{name:'Soy yo, confirmar'}).click();let a=await(await registrado).json()
 await api('/rest/v1/rpc/admin_examen_autorizar',{p_intento:a.intento.id,p_justificacion:'Identidad ficticia verificada'})
 await api('/rest/v1/sesiones?id=eq.'+sid,{estado:'activo'},{},'PATCH');await p.evaluate(()=>globalThis.window.dispatchEvent(new Event('online')))
 await expect(p.getByRole('heading',{name:'Antes de responder'})).toBeVisible();await p.getByRole('button',{name:'Comenzar a responder'}).click();await expect(p.getByRole('dialog')).toHaveCount(0);ok('solicita pantalla completa al comenzar y mantiene el reloj común')
 const sesion=await p.evaluate(()=>JSON.parse(globalThis.localStorage.getItem('ujeladea_participante_auth_v2'))),h={authorization:'Bearer '+sesion.access_token,'x-examen-instancia':instancia}
 const rpc=(n,args)=>api('/rest/v1/rpc/'+n,args,h)
 a=await rpc('examen_contacto',{p_intento:a.intento.id})
 for(let n=1;n<20;n++)a=await rpc('examen_responder',{p_intento:a.intento.id,p_pregunta:a.pregunta.id,p_texto:a.pregunta.tipo==='multiple'?a.pregunta.opciones[0]:'Respuesta ficticia de supervisión',p_solicitud:randomUUID()})
 const vence=a.intento.vence_at;await p.evaluate(()=>globalThis.window.dispatchEvent(new Event('online')));await expect(p.getByText('Pregunta 20 de 25',{exact:true})).toBeVisible()
 const texto=a.pregunta.tipo==='multiple'?a.pregunta.opciones[0]:'Borrador que debe conservarse después del incidente'
 if(a.pregunta.tipo==='multiple')await p.getByRole('group',{name:'Opciones de respuesta'}).getByRole('button').first().click();else await p.getByRole('textbox',{name:'Tu respuesta'}).fill(texto)
 await expect(p.getByText('Borrador sincronizado',{exact:true})).toBeVisible()
 await p.evaluate(()=>{globalThis.__anchoNormal=globalThis.innerWidth;globalThis.__altoNormal=globalThis.innerHeight;globalThis.__anchoVista=globalThis.innerWidth;globalThis.__altoVista=globalThis.innerHeight;Object.defineProperty(globalThis.window,'innerWidth',{configurable:true,get:()=>globalThis.__anchoVista});Object.defineProperty(globalThis.window,'innerHeight',{configurable:true,get:()=>globalThis.__altoVista})})
 const reducida=p.waitForResponse(r=>r.url().endsWith('/rpc/examen_supervisar')&&r.request().postDataJSON()?.p_senales.includes('vista_reducida'))
 await p.evaluate(()=>{globalThis.__anchoVista=globalThis.__anchoNormal/2;globalThis.window.dispatchEvent(new Event('resize'))});await reducida
 await expect(p.getByText('Pregunta 20 de 25',{exact:true})).toBeVisible();await expect(p.locator('.joven-aviso')).toContainText('La vista del examen se redujo.')
 await p.screenshot({path:dir+'/vista-reducida.png',fullPage:true});ok('vista reducida genera un indicio sin bloquear ni reiniciar la pregunta 20')
 const fin=p.waitForResponse(r=>r.url().endsWith('/rpc/examen_supervisar')&&r.request().postDataJSON()?.p_fase==='fin')
 await p.evaluate(()=>{globalThis.__anchoVista=globalThis.__anchoNormal;globalThis.window.dispatchEvent(new Event('resize'))});await fin
 let episodios=(await api('/rest/v1/rpc/admin_examen_sala',{p_sesion:sid,p_etapa:meta.etapa})).supervision.length
 await p.evaluate(()=>{const i=globalThis.document.createElement('input');i.id='teclado-sintetico';globalThis.document.body.append(i);i.focus();globalThis.__altoVista=globalThis.__altoNormal*.4;globalThis.window.dispatchEvent(new Event('resize'))});await p.waitForTimeout(3500)
 const despues=(await api('/rest/v1/rpc/admin_examen_sala',{p_sesion:sid,p_etapa:meta.etapa})).supervision.length;if(despues!==episodios)throw Error('El teclado se confundió con una vista reducida')
 await p.evaluate(()=>{globalThis.__altoVista=globalThis.__altoNormal;globalThis.document.getElementById('teclado-sintetico').remove();globalThis.window.dispatchEvent(new Event('resize'))});ok('el teclado al escribir no produce otro incidente')
 const sostenida=p.waitForResponse(r=>r.url().endsWith('/rpc/examen_supervisar')&&r.request().postDataJSON()?.p_ausencia>=15000),cierre=p.waitForResponse(r=>r.url().endsWith('/rpc/examen_supervisar')&&r.request().postDataJSON()?.p_fase==='fin'&&r.request().postDataJSON()?.p_ausencia>=15000)
 await p.evaluate(()=>{globalThis.__focoExamen=false;globalThis.window.dispatchEvent(new Event('blur'))});await sostenida;await expect(p.getByRole('heading',{name:'Volvamos a tu examen'})).toBeVisible();await cierre
 await p.screenshot({path:dir+'/revision-requerida.png',fullPage:true});ok('una pérdida sostenida de foco requiere autorización del moderador')
 await p.evaluate(()=>{globalThis.__focoExamen=true;globalThis.window.dispatchEvent(new Event('focus'))});await api('/rest/v1/rpc/admin_examen_autorizar',{p_intento:a.intento.id,p_justificacion:'Interrupción revisada en la prueba local'});await p.evaluate(()=>globalThis.window.dispatchEvent(new Event('online')))
 await expect(p.getByText('Pregunta 20 de 25',{exact:true})).toBeVisible();const actual=await rpc('examen_estado',{p_intento:a.intento.id});if(actual.pregunta.borrador!==texto||actual.intento.vence_at!==vence)throw Error('Se alteró el borrador o el plazo');ok('la autorización recupera la pregunta 20, el borrador y el mismo plazo')
 const panelCtx=await b.newContext({viewport:{width:1280,height:900}}),panel=await panelCtx.newPage();await panel.goto(base+'/demo/entrar?vista=panel',{waitUntil:'networkidle'});await panel.goto(base+'/admin/sesion/'+sid+'/espera',{waitUntil:'networkidle'});await expect(panel.getByRole('status',{name:'Alertas de '+nombre})).toContainText('Otra ventana recibió el foco');ok('alertas visibles junto al joven sin abrir un modal');await panel.locator('.participante-control').filter({has:panel.getByRole('heading',{name:nombre,exact:true})}).getByRole('button',{name:'Ver incidencias'}).click();await expect(panel.getByRole('dialog')).toContainText('Otra ventana recibió el foco');await expect(panel.getByRole('dialog')).toContainText('Duración registrada');await panel.screenshot({path:dir+'/panel-incidencias.png',fullPage:true});ok('el moderador ve las señales agrupadas y su duración')
 if(errores.length)throw Error(errores.join(' | '));await writeFile(dir+'/verificacion.json',JSON.stringify({checks,errores,alcance:'Señales controladas en navegador con PostgreSQL local; no certifica todas las ventanas flotantes de fabricantes Android.'},null,2))
}finally{await b.close()}
