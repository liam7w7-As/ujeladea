import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { createServer } from 'vite'

const require = createRequire(process.env.UJELADEA_UI_PACKAGE_JSON || new URL('../package.json', import.meta.url))
const { chromium } = require('playwright')
const { expect } = require('playwright/test')
const dir = '.local-db/ui'
await mkdir(dir, { recursive: true })
const H = '10000000-0000-4000-8000-000000000001'
const E = '10000000-0000-4000-8000-000000000002'
const S = '20000000-0000-4000-8000-000000000001'
const P = '30000000-0000-4000-8000-000000000001'
const Q = '40000000-0000-4000-8000-000000000001'
const J = '50000000-0000-4000-8000-000000000001'
const A = '60000000-0000-4000-8000-000000000001'
const hebreos = { id: H, codigo: '2026-01-hebreos', nombre: 'Primera etapa', libro: 'Hebreos', anio: 2026, numero: 1, estado: 'cerrada', historica: true, tiempo_limite: 60, cantidad_preguntas: 45, reglas: { version: 1 }, cerrado_at: '2026-07-12T00:00:00Z' }
const efesios = { id: E, codigo: '2026-02-efesios', nombre: 'Segunda etapa', libro: 'Efesios', anio: 2026, numero: 2, estado: 'borrador', historica: false, tiempo_limite: 60, cantidad_preguntas: 45, reglas: { version: 2 } }
const historico = {
 sociedades: [{ id: S, nombre: 'Sociedad histórica de prueba', iglesia: 'Iglesia de prueba', total_censo: 12, activa: true }],
 sesiones: [{ id: P, sociedad_id: S, estado: 'finalizado', tiempo_limite: 60, cantidad_preguntas: 45, created_at: '2026-07-12T00:00:00Z' }],
 preguntas: [{ id: Q, texto: 'Pregunta histórica de prueba', tipo: 'multiple', opciones: ['Primera opción', 'Segunda opción'], respuesta_correcta: 'Primera opción', puntaje: 10, activa: true }],
 participantes: [{ id: J, nombre: 'Joven ficticio', sesion_id: P, del_censo: true, examen_finalizado: true, puntaje_total: 20 }],
 respuestas: [0, 1].map(i => ({ id: randomUUID(), participante_id: J, pregunta_id: Q, respuesta_dada: 'Primera opción', puntaje_obtenido: 10, calificado_por: 'sistema', es_correcta: true, created_at: `2026-07-12T00:0${i}:00Z` })),
 eventos_sesion: [{ id: randomUUID(), participante_id: J, sesion_id: P, tipo: 'cambio_pestana', cantidad: 5 }],
}
const db = { ...structuredClone(historico), etapas: [hebreos, efesios], archivos_etapa: [{ etapa_id: H, version_formato: 1, contenido: { etapa: hebreos, datos: historico } }], resumen_alertas: [], intentos: [], intento_preguntas: [] }
db.sesiones[0].etapa_id = H
db.preguntas[0].etapa_id = H
db.sociedades[0].nombre = 'Nombre actual modificado'
const requests = []
const errores = []
const checks = []
let browser, server
function comprobar(nombre, condicion) { if (!condicion) throw new Error(nombre); checks.push(nombre); console.log('OK:', nombre) }
function session(email, admin = true) {
 const now = Math.floor(Date.now() / 1000)
 const payload = { sub: A, role: 'authenticated', exp: now + 3600, iat: now, app_metadata: admin ? { role: 'admin' } : {} }
 return { access_token: [ { alg: 'HS256', typ: 'JWT' }, payload ].map(v => Buffer.from(JSON.stringify(v)).toString('base64url')).join('.') + '.fixture',
 token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'local-ui-fixture',
 user: { id: A, email, aud: 'authenticated', role: 'authenticated', app_metadata: payload.app_metadata, user_metadata: { role: 'admin' }, created_at: new Date().toISOString() } }
}
async function mock(context) {
 await context.route('http://127.0.0.1:54329/**', async route => {
  const req = route.request()
  const url = new URL(req.url())
  const method = req.method()
  const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-expose-headers': 'content-range' }
  const json = (data, status = 200, extra = {}) => route.fulfill({ status, contentType: 'application/json', headers: { ...headers, ...extra }, body: JSON.stringify(data) })
  if (method === 'OPTIONS') return route.fulfill({ status: 204, headers })
  if (url.pathname.startsWith('/auth/v1/')) {
   if (url.pathname.endsWith('/logout')) return json({})
   const body = req.postDataJSON() || {}
   return json(session(body.email || 'admin@prueba.local', body.email !== 'sin-rol@prueba.local'))
  }
  if (url.pathname === '/rest/v1/rpc/admin_examen_crear_sesion' && method === 'POST') {
    const body = req.postDataJSON()
    const etapa = db.etapas.find(e => e.id === body.p_etapa)
    const sesion = { id: randomUUID(), etapa_id: etapa.id, sociedad_id: body.p_sociedad, estado: 'esperando', cantidad_preguntas: etapa.cantidad_preguntas, tiempo_limite: etapa.tiempo_limite, created_at: new Date().toISOString() }
    db.sesiones.push(sesion)
    db.participantes.push(...body.p_participantes.map(p => ({ id: randomUUID(), sesion_id: sesion.id, ...p, registrado_at: null, seed: null, examen_finalizado: false, puntaje_total: 0 })))
    return json({ sesion_id: sesion.id })
  }
  if (url.pathname === '/rest/v1/rpc/admin_examen_sala' && method === 'POST') {
    const body = req.postDataJSON()
    const sesion = db.sesiones.find(s=>s.id===body.p_sesion&&s.etapa_id===body.p_etapa)
    if(!sesion)return json({code:'42501',message:'Sesión ajena'},403)
    const sociedad=db.sociedades.find(s=>s.id===sesion.sociedad_id)
    return json({servidor_at:new Date().toISOString(),sesion:{...sesion,sociedades:sociedad},participantes:db.participantes.filter(p=>p.sesion_id===sesion.id),alertas:[]})
  }
  const tabla = url.pathname.split('/').at(-1)
  requests.push({ tabla, method, filtros: Object.fromEntries(url.searchParams) })
  if (!db[tabla]) return json({ code: '42P01', message: 'Tabla no encontrada' }, 404)
  const matches = row => [...url.searchParams].every(([k, v]) => {
   if (['select', 'order', 'limit', 'offset'].includes(k)) return true
   if (v.startsWith('eq.')) return String(row[k]) === v.slice(3)
   if (v.startsWith('in.(')) return v.slice(4, -1).split(',').includes(String(row[k]))
   return true
  })
  let rows = db[tabla].filter(matches)
  if (method === 'POST') {
   const body = req.postDataJSON()
   rows = (Array.isArray(body) ? body : [body]).map(r => ({ id: randomUUID(), created_at: new Date().toISOString(), ...r }))
   db[tabla].push(...rows)
  }
  if (method === 'PATCH') {
   const body = req.postDataJSON()
   if (tabla === 'etapas' && body.estado === 'activa' && rows.some(e => db.preguntas.filter(p => p.etapa_id === e.id && p.activa).length < e.cantidad_preguntas)) return json({ code: 'P0001', message: 'No hay suficientes preguntas activas' }, 400)
   rows.forEach(r => Object.assign(r, body))
  }
  const total = rows.length
  const offset = Number(url.searchParams.get('offset') || 0)
  const limit = Number(url.searchParams.get('limit') || total)
  rows = rows.toSorted((a, b) => a.id?.localeCompare(b.id)).slice(offset, offset + limit)
  if (tabla === 'sesiones' && url.searchParams.get('select')?.includes('sociedades')) rows = rows.map(r => ({ ...r, sociedades: db.sociedades.find(s => s.id === r.sociedad_id) }))
  if (method === 'HEAD') return route.fulfill({ status: 200, headers: { ...headers, 'content-range': `0-${Math.max(0, total - 1)}/${total}` } })
  if (req.headers().accept?.includes('application/vnd.pgrst.object+json')) return rows.length === 1 ? json(rows[0]) : json({ code: 'PGRST116', message: 'No se encontró el registro' }, 406)
  return json(rows)
 })
}
try {
 process.env.VITE_SUPABASE_URL = 'http://127.0.0.1:54329'
 process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ui_fixture_only'
 server = await createServer({ server: { host: '127.0.0.1', port: 4173, strictPort: true }, logLevel: 'error' })
 await server.listen()
 browser = await chromium.launch({ channel: process.env.UJELADEA_UI_BROWSER || 'msedge', headless: true })
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true })
 await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
 await mock(context)
 const page = await context.newPage()
 page.on('pageerror', err => errores.push(err.message))
 await page.goto('http://127.0.0.1:4173/admin/login')
 await page.getByLabel('Correo electrónico').fill('sin-rol@prueba.local')
 await page.getByLabel('Contraseña').fill('prueba-local-no-real')
 await page.getByRole('button', { name: 'Ingresar al panel' }).click()
 await expect(page.getByRole('alert')).toContainText('no tiene el rol')
 checks.push('rechaza usuario sin rol aunque user_metadata diga admin')
 await page.getByLabel('Correo electrónico').fill('admin@prueba.local')
 await page.getByRole('button', { name: 'Ingresar al panel' }).click()
 await expect(page.getByRole('button', { name: 'Preparar Efesios' })).toBeVisible()
 await page.screenshot({ path: dir + '/etapas-escritorio.png', fullPage: true })
 await page.setViewportSize({ width: 390, height: 844 })
 await page.screenshot({ path: dir + '/etapas-movil-inicial.png', fullPage: true })
 await page.setViewportSize({ width: 1440, height: 1000 })
 comprobar('Efesios comienza sin banco y no puede activarse', !(await page.getByRole('button', { name: 'Activar etapa' }).isEnabled()))
 await page.getByRole('button', { name: 'Consultar Hebreos' }).click()
 await expect(page.getByRole('heading', { name: 'Sociedad histórica de prueba' })).toBeVisible()
 comprobar('historial usa nombre congelado', !(await page.getByText('Nombre actual modificado', { exact: true }).count()))
 comprobar('historial oculta crear sesiones', !(await page.getByRole('link', { name: 'Nueva sesión' }).count()))
 await page.getByRole('link', { name: 'Resultados', exact: true }).click()
 await expect(page.getByRole('heading', { name: 'Sociedad histórica de prueba' })).toBeVisible()
 await expect(page.getByRole('cell', { name: '20', exact: true }).first()).toBeVisible()
 await page.screenshot({ path: dir + '/hebreos-resultados.png', fullPage: true })
 const [individual] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: 'Exportar informe de Joven ficticio' }).click()])
 await individual.waitForURL(/^blob:/)
 const individualBytes = await page.evaluate(async url => Array.from(new Uint8Array(await (await fetch(url)).arrayBuffer())), individual.url())
 await writeFile(dir + '/historico-individual.pdf', Buffer.from(individualBytes))
 await individual.close()
 comprobar('PDF individual pesa menos de un MB', (await readFile(dir + '/historico-individual.pdf')).length < 1000000)
 comprobar('exporta informe histórico completo desde archivo', (await readFile(dir + '/historico-individual.pdf')).subarray(0, 4).toString() === '%PDF')
 await page.getByRole('link', { name: 'Ranking', exact: true }).click()
 await expect(page.getByRole('heading', { name: 'Ranking de la etapa' })).toBeVisible()
 await expect(page.getByText('Sociedad histórica de prueba', { exact: true }).first()).toBeVisible()
 await page.getByRole('link', { name: 'Preguntas', exact: true }).click()
 await expect(page.getByRole('heading', { name: 'Pregunta histórica de prueba' })).toBeVisible()
 comprobar('banco histórico no tiene edición', !(await page.getByRole('link', { name: 'Editar', exact: true }).count()))
 await page.goto('http://127.0.0.1:4173/admin/preguntas/' + Q + '/editar')
 await expect(page.getByRole('heading', { name: 'Etapa cerrada' })).toBeVisible()
 checks.push('bloquea edición histórica por enlace directo')
 await page.getByRole('link', { name: 'Etapas', exact: true }).click()
 await page.getByRole('button', { name: 'Consultar Hebreos' }).click()
 await expect(page.getByRole('heading', { name: 'Sesiones de Hebreos' })).toBeVisible()
 checks.push('reabrir la misma etapa no deja el panel cargando')
 await page.getByRole('link', { name: 'Etapas', exact: true }).click()
 await page.getByRole('button', { name: 'Preparar Efesios' }).click()
 await expect(page.getByRole('heading', { name: 'Sesiones de Efesios' })).toBeVisible()
 await expect(page.getByRole('heading', { name: 'Todo listo para organizarte' })).toBeVisible()
 await page.getByRole('link',{name:'Ranking',exact:true}).click()
 await expect(page.getByRole('button',{name:'Informe para Directiva (PDF)'})).toBeEnabled()
 const [preparacionPdf]=await Promise.all([page.waitForEvent('popup'),page.getByRole('button',{name:'Informe para Directiva (PDF)'}).click()])
 await preparacionPdf.waitForURL(/^blob:/)
 const preparacionBytes=await page.evaluate(async url=>Array.from(new Uint8Array(await (await fetch(url)).arrayBuffer())),preparacionPdf.url())
 await writeFile(dir+'/efesios-preparacion.pdf',Buffer.from(preparacionBytes))
 await preparacionPdf.close()
 comprobar('exporta un informe de preparación de Efesios aunque todavía no haya preguntas ni sesiones',Buffer.from(preparacionBytes).toString('latin1').includes('Efesios'))
 await page.goto('http://127.0.0.1:4173/admin/sesion/' + P + '/resultados')
 await expect(page.getByRole('alert')).toContainText('etapa seleccionada')
 checks.push('rechaza enlace de Hebreos mientras Efesios está seleccionada')
 await page.getByRole('link', { name: 'Preguntas', exact: true }).click()
 await expect(page.getByRole('heading', { name: 'Prepara el banco de Efesios' })).toBeVisible()
 await page.getByRole('link', { name: 'Nueva pregunta', exact: true }).click()
 await page.getByPlaceholder('Escribe la pregunta detalladamente...').fill('Pregunta sintética de Efesios para prueba de interfaz')
 await page.getByPlaceholder('Opción A', { exact: true }).fill('Opción correcta de prueba')
 await page.getByPlaceholder('Opción B', { exact: true }).fill('Otra opción de prueba')
 await page.getByText('Opción A:', { exact: true }).click()
 await page.getByRole('button', { name: 'Guardar Pregunta' }).click()
 await expect(page.getByRole('heading', { name: 'Banco de preguntas' })).toBeVisible()
 await expect(page.getByRole('heading', { name: 'Pregunta sintética de Efesios para prueba de interfaz' })).toBeVisible()
 comprobar('inserta pregunta con etapa Efesios', db.preguntas.some(p => p.etapa_id === E && p.texto.startsWith('Pregunta sintética')))
 const [download] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: 'Exportar PDF' }).click()])
 await download.waitForURL(/^blob:/)
 const bancoBytes = await page.evaluate(async url => Array.from(new Uint8Array(await (await fetch(url)).arrayBuffer())), download.url())
 await writeFile(dir + '/banco-efesios.pdf', Buffer.from(bancoBytes))
 await download.close()
 const pdf = (await readFile(dir + '/banco-efesios.pdf')).toString('latin1')
 comprobar('PDF del banco pesa menos de un MB', (await readFile(dir + '/banco-efesios.pdf')).length < 1000000)
 comprobar('PDF de Efesios no lleva etiqueta Hebreos', pdf.includes('Efesios') && !pdf.includes('HEBREOS') && !pdf.includes('Hebreos'))
 await page.getByRole('link', { name: 'Etapas', exact: true }).click()
 await page.getByRole('button', { name: 'Configurar' }).click()
 const editor = page.locator('.etapa-editor')
 await editor.getByLabel('Preguntas por joven').fill('1')
 await editor.getByRole('button', { name: 'Guardar preparación' }).click()
 await expect(page.getByRole('button', { name: 'Activar etapa' })).toBeEnabled()
 await page.getByRole('button', { name: 'Activar etapa' }).click()
 await expect(page.getByRole('dialog')).toContainText('quedarán fijas')
 await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
 comprobar('cancelar activación conserva el borrador', efesios.estado === 'borrador')
 await page.getByRole('button', { name: 'Activar etapa' }).click()
 await page.getByRole('button', { name: 'Sí, activar etapa' }).click()
 await expect(page.getByRole('button', { name: 'Administrar Efesios' })).toBeVisible()
 comprobar('activa únicamente la etapa seleccionada', efesios.estado === 'activa' && hebreos.estado === 'cerrada')
 await page.getByRole('button', { name: 'Administrar Efesios' }).click()
 await page.getByRole('link', { name: 'Nueva sesión', exact: true }).click()
 await page.getByText('Nombre actual modificado', { exact: true }).click()
 await page.getByPlaceholder('Nombre del participante...').fill('Joven de prueba de Efesios')
 await page.getByRole('button', { name: 'Agregar participante' }).click()
 await page.getByRole('button', { name: 'Continuar', exact: true }).click()
 await page.getByRole('button', { name: 'Crear y Generar QR' }).click()
 await page.waitForURL(/\/admin\/sesion\/[^/]+\/espera$/)
 await expect(page.getByText('Segunda etapa · Efesios · 2026', { exact: true })).toBeVisible()
 comprobar('crea sesión de Efesios con la configuración de su etapa', db.sesiones.some(s => s.etapa_id === E && s.cantidad_preguntas === 1 && s.tiempo_limite === 60))
 comprobar('crea participantes solo en la nueva sesión', db.participantes.some(p => p.nombre === 'Joven de prueba de Efesios' && db.sesiones.some(s => s.id === p.sesion_id && s.etapa_id === E)))
 await page.goto('http://127.0.0.1:4173/admin/etapas')
 await expect(page.getByRole('button', { name: 'Administrar Efesios' })).toBeVisible()
 await page.getByRole('button', { name: 'Crear nueva etapa' }).click()
 await page.getByLabel('Nombre de la etapa').fill('Tercera etapa de prueba')
 await page.getByLabel('Libro de la Biblia').fill('Libro de prueba')
 await page.getByRole('button', { name: 'Guardar preparación' }).click()
 await expect(page.getByRole('heading', { name: 'Libro de prueba', exact: true })).toBeVisible()
 comprobar('crea nueva etapa sin sobrescribir las anteriores', db.etapas.length === 3 && db.etapas[2].numero === 3)
 await page.setViewportSize({ width: 390, height: 844 })
 await page.screenshot({ path: dir + '/etapas-movil.png', fullPage: true })
 comprobar('panel móvil sin desbordamiento horizontal', await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth))
 await page.getByRole('button', { name: 'Consultar Hebreos' }).click()
 await page.getByRole('link', { name: 'Resultados', exact: true }).click()
 await expect(page.getByRole('heading', { name: 'Resultados por joven' })).toBeVisible()
 comprobar('resultados móviles permiten desplazamiento de tabla sin romper la página', await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth))
 comprobar('ninguna escritura tocó Hebreos', !requests.some(r => ['POST', 'PATCH', 'DELETE'].includes(r.method) && JSON.stringify(r.filtros).includes(H)))
 comprobar('sin errores de ejecución React', errores.length === 0)
 await context.close()
 await server.close()
 process.env.VITE_SUPABASE_URL = ''
 process.env.VITE_SUPABASE_PUBLISHABLE_KEY = ''
 process.env.VITE_SUPABASE_ANON_KEY = ''
 server = await createServer({ server: { host: '127.0.0.1', port: 4173, strictPort: true }, logLevel: 'error' })
 await server.listen()
 const sinConfig = await browser.newPage()
 await sinConfig.goto('http://127.0.0.1:4173/')
 await expect(sinConfig.getByRole('heading', { name: 'Conecta tu entorno de pruebas' })).toBeVisible()
 comprobar('sin variables muestra configuración pendiente en lugar de pantalla vacía', true)
 await sinConfig.close()
 await writeFile(dir + '/informe.json', JSON.stringify({ tipo: 'UI con REST y Auth simulados; datos ficticios; sin Supabase real', checks, errores, peticiones: requests.length }, null, 2))
 console.log(JSON.stringify({ checks: checks.length, errores, capturas: dir }, null, 2))
} catch (err) {
 console.error(err.stack)
 if (browser) { const page = browser.contexts()[0]?.pages()[0]; if (page) { await page.screenshot({ path: dir + '/fallo.png', fullPage: true }); console.error((await page.locator('body').innerText()).slice(0, 4000)) } }
 process.exitCode = 1
} finally { if (browser) await browser.close(); if (server) await server.close() }
