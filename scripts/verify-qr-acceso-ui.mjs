import {createRequire} from 'node:module'
import {mkdir,writeFile} from 'node:fs/promises'
import jsQR from 'jsqr'
const require=createRequire(process.env.UJELADEA_UI_PACKAGE_JSON||new URL('../package.json',import.meta.url))
const {chromium}=require('playwright'),expect=require('playwright/test').expect.configure({timeout:15000})
const base=process.env.UJELADEA_DEMO_URL||'http://127.0.0.1:5183'
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(base))throw Error('Solo se admite la demo local aislada')
const dir='.local-db/qr-acceso';await mkdir(dir,{recursive:true})
const meta=await(await fetch(base+'/demo/estado')).json()
const browser=await chromium.launch({channel:'msedge',headless:true}),errors=[],checks=[]
const ok=s=>{checks.push(s);console.log('OK: '+s)}
function decodificar({data,width,height},esperado){const qr=jsQR(new Uint8ClampedArray(data),width,height);if(qr?.data!==esperado)throw Error('El QR no codifica el enlace completo esperado')}
async function comprobarSvg(page,esperado){
 const imagen=await page.locator('.qr-panel>svg').evaluate(async svg=>{
  const url=URL.createObjectURL(new Blob([new globalThis.XMLSerializer().serializeToString(svg)],{type:'image/svg+xml'}))
  try{const img=new globalThis.Image();img.src=url;await img.decode();const c=globalThis.document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);return{data:[...ctx.getImageData(0,0,c.width,c.height).data],width:c.width,height:c.height}}finally{URL.revokeObjectURL(url)}
 });decodificar(imagen,esperado)
}
try{
 const panelContext=await browser.newContext({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write']})
 await panelContext.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort())
 const panel=await panelContext.newPage();panel.on('pageerror',e=>errors.push(e.message))
 await panel.goto(base+'/demo/entrar?vista=panel',{waitUntil:'networkidle'})
 await panel.goto(base+'/admin/sesion/'+meta.espera+'/espera?qr=1',{waitUntil:'networkidle'})
 const modal=panel.getByRole('dialog',{name:'Acceso a la sesión'}),url=base+'/examen/'+meta.espera
 await expect(modal).toBeVisible();await expect(panel).toHaveURL(base+'/admin/sesion/'+meta.espera+'/espera')
 await comprobarSvg(panel,url);ok('QR automático y enlace completo decodificables; parámetro de apertura retirado')
 await modal.getByRole('button',{name:'Copiar enlace',exact:true}).click();await expect(modal.getByRole('status')).toHaveText('Enlace copiado.')
 if(await panel.evaluate(()=>navigator.clipboard.readText())!==url)throw Error('El portapapeles no contiene el enlace correcto')
 ok('copia el enlace completo desde el panel')
 await modal.getByRole('button',{name:'Aceptar',exact:true}).click();await panel.reload({waitUntil:'networkidle'});await expect(panel.getByRole('dialog')).toHaveCount(0)
 await panel.getByRole('button',{name:'Mostrar QR de la sesión'}).click();ok('puede volver a mostrar el QR; recargar no lo abre de nuevo')
 for(const [nombre,viewport,media] of [['movil',{width:390,height:844},{colorScheme:'light'}],['pantalla-baja',{width:360,height:640},{colorScheme:'dark'}],['alto-contraste',{width:390,height:844},{forcedColors:'active'}]]){
  await panel.setViewportSize(viewport);await panel.emulateMedia(media);await expect(panel.locator('.qr-panel>svg')).toBeVisible();await comprobarSvg(panel,url)
  if(await panel.evaluate(()=>globalThis.document.documentElement.scrollWidth>globalThis.innerWidth))throw Error('Desbordamiento horizontal: '+nombre)
  await panel.screenshot({path:dir+'/qr-'+nombre+'.png',fullPage:true});ok('QR legible y decodificable en '+nombre)
 }
 await panel.emulateMedia({forcedColors:'none',colorScheme:'light'})
 // La descarga debe funcionar aunque el visor SVG no se muestre.
 await panel.locator('.qr-panel>svg').evaluate(s=>{s.style.visibility='hidden'})
 const descarga=panel.waitForEvent('download');await modal.getByRole('button',{name:'Descargar QR',exact:true}).click();const archivo=await descarga;await archivo.saveAs(dir+'/QR_sesion.png')
 const imagen=await panel.locator('.qr-panel>canvas').evaluate(c=>({data:[...c.getContext('2d').getImageData(0,0,c.width,c.height).data],width:c.width,height:c.height}))
 decodificar(imagen,url);await expect(modal.getByRole('status')).toHaveText('QR descargado como imagen.');ok('descarga PNG válido como alternativa independiente del visor SVG')
 await modal.getByRole('button',{name:'Aceptar',exact:true}).click()
 await panel.goto(base+'/admin/sesion/'+meta.curso+'/espera',{waitUntil:'networkidle'})
 await panel.getByRole('button',{name:'QR personal de recuperación',exact:true}).first().click()
 const personal=panel.getByRole('dialog',{name:'Autorización personal'});await expect(personal).toBeVisible()
 const enlace=await personal.locator('a.qr-enlace').getAttribute('href');if(!enlace.includes('#recuperacion='))throw Error('No se incluyó el código personal')
 await comprobarSvg(panel,enlace);ok('QR de recuperación conserva el código personal en el fragmento del enlace')
 await personal.getByRole('button',{name:'Aceptar',exact:true}).click()
 await panel.route('**/rpc/admin_examen_sala',async r=>{const respuesta=await r.fetch(),datos=await respuesta.json();await r.fulfill({response:respuesta,json:{...datos,etapa_estado:'borrador'}})})
 await panel.goto(base+'/admin/sesion/'+meta.espera+'/espera',{waitUntil:'networkidle'})
 await expect(panel.getByRole('region',{name:'Registro pendiente de habilitar'})).toBeVisible();await expect(panel.getByRole('link',{name:'Ir a activar la evaluación'})).toHaveAttribute('href','/admin/etapas')
 await expect(panel.getByRole('button',{name:'Iniciar examen',exact:true})).toBeDisabled();ok('el estado actualizado del servidor avisa al moderador y mantiene bloqueado el inicio')
 const jovenContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true})
 await jovenContext.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort())
 const joven=await jovenContext.newPage();joven.on('pageerror',e=>errors.push(e.message));let preparado=false,causa='etapa_en_preparacion',consultas=0
 await joven.route('**/rpc/examen_sala',async r=>{const respuesta=await r.fetch(),datos=await respuesta.json();consultas++;await r.fulfill({response:respuesta,json:preparado?datos:{...datos,etapa:{...datos.etapa,estado:causa==='etapa_en_preparacion'?'borrador':'activa'},disponible:false,motivo_no_disponible:causa,participantes:[]}})})
 await joven.goto(url,{waitUntil:'networkidle'});await expect(joven.getByRole('heading',{name:'El encargado está preparando la evaluación'})).toBeVisible();await expect(joven.getByRole('group',{name:'Participantes disponibles'})).toHaveCount(0)
 await joven.screenshot({path:dir+'/registro-preparacion.png',fullPage:true})
 const antes=consultas;await joven.getByRole('button',{name:'Volver a comprobar el acceso'}).click();await expect.poll(()=>consultas).toBeGreaterThan(antes);ok('el joven recibe la causa exacta y puede comprobar el acceso sin escanear de nuevo')
 preparado=true;await joven.evaluate(()=>globalThis.window.dispatchEvent(new Event('online')))
 await expect(joven.getByRole('heading',{name:'Selecciona tu nombre'})).toBeVisible();await expect(joven.getByRole('group',{name:'Participantes disponibles'}).getByRole('button')).toHaveCount(3)
 ok('recuperar la conexión actualiza la pantalla y habilita el registro conservando la misma URL')
 preparado=false;causa='tiempo_finalizado';await joven.reload({waitUntil:'networkidle'});await expect(joven.getByRole('heading',{name:'Esta sesión ha finalizado'})).toBeVisible();ok('una sesión vencida informa del cierre, sin invitar a esperar su apertura')
 if(errors.length)throw Error(errors.join(' | '))
 await writeFile(dir+'/verificacion.json',JSON.stringify({checks,errors,alcance:'Navegadores automatizados con datos ficticios; Android real en emulador se verifica aparte en el dominio publicado'},null,2))
 console.log('Comprobaciones completadas: '+checks.length)
}finally{await browser.close()}
