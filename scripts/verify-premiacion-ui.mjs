import {createRequire} from 'node:module'
import {writeFile} from 'node:fs/promises'
const require=createRequire(process.env.UJELADEA_UI_PACKAGE_JSON || new URL('../package.json',import.meta.url))
const{chromium}=require('playwright')
const expect=require('playwright/test').expect.configure({timeout:20000})
const base=process.env.UJELADEA_DEMO_URL || 'http://127.0.0.1:5178'
if(!/^http:\/\/127\.0\.0\.1:/.test(base))throw Error('Solo se permite la demo aislada')
const browser=await chromium.launch({channel:process.env.UJELADEA_UI_BROWSER || 'msedge',headless:true})
const contexto=await browser.newContext({viewport:{width:1440,height:1000}})
await contexto.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort())
const page=await contexto.newPage(),errores=[],checks=[]
page.on('pageerror',e=>errores.push(e.message))
const ok=s=>{checks.push(s);console.log('OK: '+s)}
try {
 await page.goto(base+'/demo/entrar?vista=panel',{waitUntil:'networkidle'})
 await page.getByRole('link',{name:'Premiación',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Premiación general',exact:true})).toBeVisible()
 await expect(page.getByText('Acumulado provisional',{exact:true})).toBeVisible()
 await expect(page.getByRole('heading',{name:'Resultados preservados de Hebreos'})).toBeVisible()
 ok('presenta Hebreos preservado y el acumulado pendiente sin convertir ausencias en cero')
 const fila=page.getByRole('row').filter({has:page.getByRole('rowheader',{name:'Joven con examen finalizado',exact:true})})
 await fila.getByRole('button',{name:'Verificar identidad',exact:true}).click()
 await page.getByLabel('Participante de Hebreos',{exact:true}).selectOption({label:'Participante histórico ficticio · Sociedad histórica de muestra'})
 await page.getByLabel('Cómo verificaste la identidad').fill('Identidad ficticia comprobada durante el ensayo local')
 await page.getByRole('dialog').getByRole('button',{name:'Aceptar',exact:true}).click()
 await expect(page.getByRole('dialog')).toHaveCount(0)
 await expect(fila.getByRole('button',{name:'Revisar identidad',exact:true})).toBeVisible()
 ok('la vinculación manual conserva ambas notas y queda registrada')
 const otro=page.getByRole('row').filter({has:page.getByRole('rowheader',{name:'Joven para revisar calificación',exact:true})})
 await otro.getByRole('button',{name:'Verificar identidad',exact:true}).click()
 await page.getByLabel('Participante de Hebreos',{exact:true}).selectOption('solo')
 await page.getByLabel('Cómo verificaste la identidad').fill('Se comprobó que solo participó en Efesios; datos ficticios')
 await page.getByRole('dialog').getByRole('button',{name:'Aceptar',exact:true}).click()
 await expect(page.getByRole('dialog')).toHaveCount(0)
 await expect(otro.getByText('Participó solo en Efesios',{exact:true})).toBeVisible()
 ok('un participante nuevo conserva Efesios sin inventar un cero de Hebreos')
 await page.getByLabel('PDF original de resultados de Hebreos',{exact:true}).setInputFiles({
   name:'resultados-hebreos-ficticios.pdf',mimeType:'application/pdf',
   buffer:Buffer.from('%PDF-1.4\n% Archivo sintético exclusivo del ensayo de selección y huella\n%%EOF'),
 })
 await page.getByLabel('Observación de la comprobación').fill('Comprobación manual simulada con datos exclusivamente ficticios')
 await page.getByLabel('Revisé el PDF original y los resultados coinciden con los valores preservados.').check()
 await page.getByRole('button',{name:'Registrar comprobación',exact:true}).click()
 await page.getByRole('button',{name:'Confirmar comparación',exact:true}).click()
 await expect(page.getByRole('dialog')).toHaveCount(0)
 await expect(page.getByText(/Comparación manual registrada el/)).toBeVisible()
 await expect(page.getByRole('button',{name:'Registrar comprobación',exact:true})).toHaveCount(0)
 ok('guarda la declaración y huella del archivo sin subirlo ni modificar resultados')
 await page.evaluate(()=>globalThis.window.scrollTo(0,0))
 await page.screenshot({path:'.local-db/demo-v3/premiacion.png',fullPage:true})
 await page.setViewportSize({width:390,height:844})
 if(await page.evaluate(()=>globalThis.document.documentElement.scrollWidth>globalThis.innerWidth))throw Error('Desbordamiento horizontal')
 await page.screenshot({path:'.local-db/demo-v3/premiacion-movil.png',fullPage:true})
 if(errores.length)throw Error(errores.join('\n'))
 ok('vista móvil sin desbordamiento y sin errores de React')
 await writeFile('.local-db/demo-v3/premiacion-ui.json',JSON.stringify({checks,errores,alcance:'Edge y PostgreSQL local con Auth simulado. PDF sintético; no certifica un PDF real.'},null,2))
} catch(e) {
 console.error(e.stack);console.error((await page.locator('body').innerText()).slice(0,3800))
 await page.screenshot({path:'.local-db/demo-v3/fallo-premiacion.png',fullPage:true})
 process.exitCode=1
} finally {await browser.close()}
