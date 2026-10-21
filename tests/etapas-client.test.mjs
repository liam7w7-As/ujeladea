import test from 'node:test'
import assert from 'node:assert/strict'
import { cargarDatosEtapa, codigoEtapa, datosArchivo, esAdmin, leerTodas, participantesSesion, puntajeSesion, rankingEtapa, respuestasParticipante, sesionConSociedad, validarEtapa } from '../src/lib/etapas.js'

const hebreos = { id: 'hebreos', estado: 'cerrada', libro: 'Hebreos' }
const efesios = { id: 'efesios', estado: 'borrador', libro: 'Efesios' }
function fixture() {
  return {
    sociedades: [{ id: 'sociedad', nombre: 'Nombre histórico', iglesia: 'Prueba', total_censo: 5 }],
    sesiones: [{ id: 'sesion-h', sociedad_id: 'sociedad', estado: 'finalizado', created_at: '2026-07-01T00:00:00Z' }],
    preguntas: [{ id: 'pregunta-h', texto: 'Pregunta de prueba', puntaje: 10 }],
    participantes: [{ id: 'joven-h', sesion_id: 'sesion-h', nombre: 'Participante ficticio', del_censo: true, puntaje_total: 20, examen_finalizado: true }],
    respuestas: [0, 1].map(i => ({ id: 'respuesta-h-' + i, participante_id: 'joven-h', pregunta_id: 'pregunta-h', puntaje_obtenido: 10, calificado_por: 'sistema', created_at: `2026-07-01T00:0${i}:00Z` })),
    eventos_sesion: [{ id: 'evento-h', participante_id: 'joven-h', sesion_id: 'sesion-h', cantidad: 20 }],
  }
}
function cliente(datos, registro = []) {
  return { from(tabla) {
    let filtros = []
    let columnas = "*"
    let inicio = 0
    let fin = Infinity
    let singular = false
    const consulta = {
      select(campos = "*") { columnas = campos; return consulta },
      eq(campo, valor) { filtros.push(f => f[campo] === valor); return consulta },
      in(campo, valores) { filtros.push(f => valores.includes(f[campo])); return consulta },
      order() { return consulta },
      range(a, b) { inicio = a; fin = b; return consulta },
      single() { singular = true; return consulta },
      then(resolve, reject) {
        registro.push({ tabla, inicio, fin, columnas })
        const filas = (datos[tabla] || []).filter(f => filtros.every(fn => fn(f))).toSorted((a, b) => a.id?.localeCompare(b.id)).slice(inicio, fin + 1)
        return Promise.resolve({ data: singular ? filas[0] : filas, error: null }).then(resolve, reject)
      },
    }
    return consulta
  } }
}

test('el rol administrativo procede exclusivamente de app_metadata con usuario identificado', () => {
  assert.equal(esAdmin({ user: { id: 'a', app_metadata: { role: 'admin' } } }), true)
  for (const session of [null, {}, { user: { id: 'a', user_metadata: { role: 'admin' } } }, { user: { app_metadata: { role: 'admin' } } }, { user: { id: 'a', app_metadata: { role: 'joven' } } }]) assert.equal(esAdmin(session), false)
})
test('valida configuración y códigos de etapa sin admitir decimales ni límites inválidos', () => {
  const form = { nombre: ' Segunda etapa ', libro: ' Efesios ', anio: '2026', numero: '2', tiempo_limite: '60', cantidad_preguntas: '45' }
  const payload = validarEtapa(form)
  assert.equal(codigoEtapa(payload), '2026-02-efesios')
  assert.equal(payload.nombre, 'Segunda etapa')
  for (const cambio of [{ cantidad_preguntas: '2.5' }, { tiempo_limite: 0 }, { anio: 1999 }, { numero: -1 }, { libro: ' ' }]) assert.throws(() => validarEtapa({ ...form, ...cambio }))
})
test('rechaza archivos ausentes, incompletos, de otra etapa o de otro formato', () => {
  const archivo = { etapa_id: hebreos.id, version_formato: 1, contenido: { etapa: hebreos, datos: fixture() } }
  assert.equal(datosArchivo(archivo, hebreos).respuestas.length, 2)
  for (const cambio of [{ etapa_id: efesios.id }, { version_formato: 2 }, { contenido: { etapa: efesios, datos: fixture() } }, { contenido: { etapa: hebreos, datos: {} } }]) assert.throws(() => datosArchivo({ ...archivo, ...cambio }, hebreos))
})
test('una etapa cerrada lee solo el archivo y nunca consulta las tablas actuales', async () => {
  const datos = fixture()
  const log = []
  const api = cliente({ archivos_etapa: [{ etapa_id: hebreos.id, version_formato: 1, contenido: { etapa: hebreos, datos } }] }, log)
  assert.equal((await cargarDatosEtapa(api, hebreos)).sociedades[0].nombre, 'Nombre histórico')
  assert.deepEqual(log.map(l => l.tabla), ['archivos_etapa'])
  const rechazado = { from() { throw new Error('El archivo falta') } }
  await assert.rejects(cargarDatosEtapa(rechazado, hebreos), /archivo falta/)
  assert.equal(await cargarDatosEtapa(rechazado, hebreos, datos), datos)
})
test('la lectura paginada conserva más de mil respuestas y filtra todas las relaciones por etapa', async () => {
  const datos = fixture()
  datos.sesiones.push({ id: 'sesion-e', etapa_id: efesios.id, sociedad_id: 'sociedad', estado: 'esperando' })
  datos.sesiones[0].etapa_id = hebreos.id
  datos.preguntas[0].etapa_id = hebreos.id
  datos.preguntas.push({ id: 'pregunta-e', etapa_id: efesios.id, puntaje: 10 })
  datos.participantes.push({ id: 'joven-e', sesion_id: 'sesion-e' })
  datos.respuestas.push(...Array.from({ length: 1251 }, (_, i) => ({ id: 'e-' + String(i).padStart(5, '0'), participante_id: 'joven-e', pregunta_id: 'pregunta-e' })))
  const log = []
  const actual = await cargarDatosEtapa(cliente(datos, log), efesios)
  assert.equal(actual.sesiones.length, 1)
  assert.equal(actual.preguntas.length, 1)
  assert.equal(actual.participantes.length, 1)
  assert.equal(actual.respuestas.length, 1251)
  assert.ok(actual.respuestas.every(r => r.participante_id === 'joven-e'))
  assert.equal(actual.eventos_sesion.length, 0)
  assert.deepEqual(log.filter(l => l.tabla === 'respuestas').map(l => l.inicio), [0, 500, 1000])
})
test('no realiza consultas con listas vacías ni mezcla preguntas de Hebreos al preparar Efesios', async () => {
  const log = []
  const datos = await cargarDatosEtapa(cliente(fixture(), log), efesios)
  assert.deepEqual(datos, { sociedades: [], sesiones: [], participantes: [], preguntas: [], respuestas: [], eventos_sesion: [] })
  assert.deepEqual(log.map(l => l.tabla).sort(), ['preguntas', 'sesiones'])
  await assert.rejects(cargarDatosEtapa(cliente({}), null), /Selecciona una etapa/)
})
test('un fallo en cualquier página interrumpe la lectura, sin mostrar resultados parciales', async () => {
  let llamadas = 0
  await assert.rejects(leerTodas(() => ({
    order() { return this },
    range() { return Promise.resolve(++llamadas === 1 ? { data: [{ id: 1 }], error: null } : { data: null, error: new Error('Sin conexión') }) },
  }), 1), /Sin conexión/)
})
test('el historial conserva respuestas duplicadas, puntajes y el conteo V1 de eventos sin mutar el archivo', () => {
  const datos = fixture()
  const original = JSON.stringify(datos)
  const stats = puntajeSesion(datos, 'sesion-h')
  assert.equal(stats.puntajeObtenido, 20)
  assert.equal(stats.puntajeMaximo, 20)
  assert.equal(stats.totalAlertas, 1)
  assert.equal(stats.penalizacionPorcentaje, 0)
  assert.equal(participantesSesion(datos, 'sesion-h')[0].puntaje_total, 20)
  assert.equal(respuestasParticipante(datos, 'joven-h').length, 2)
  assert.equal(rankingEtapa(datos).rankingSociedades[0].sociedad, 'Nombre histórico')
  assert.equal(rankingEtapa(datos).topJovenes[0].puntaje, 20)
  assert.equal(JSON.stringify(datos), original)
})
test('un enlace a una sesión ajena no produce resultados y las etapas vacías tienen métricas cero', () => {
  assert.throws(() => sesionConSociedad(fixture(), 'sesion-e'), /no pertenece/)
  assert.throws(() => participantesSesion(fixture(), 'sesion-e'), /no pertenece/)
  const datos = Object.fromEntries(Object.keys(fixture()).map(k => [k, []]))
  const ranking = rankingEtapa(datos)
  assert.deepEqual(ranking.rankingSociedades, [])
  assert.equal(ranking.metricasGlobales.totalJovenes, 0)
  assert.equal(ranking.metricasGlobales.mejorNota, null)
})

test('resultados de V2 limitan las consultas a una sesión y usan snapshots sin descargar el banco',async()=>{
  const {cargarDatosSesion}=await import('../src/lib/etapas.js')
  const {ejemploEfesios}=await import('../scripts/lib/ejemplo-efesios.mjs')
  const {etapa,datos}=ejemploEfesios()
  const log=[]
  const actual=await cargarDatosSesion(cliente(datos,log),etapa,'sesion-0')
  assert.equal(actual.sesiones.length,1)
  assert.ok(actual.participantes.every(p=>p.sesion_id==='sesion-0'))
  assert.equal(actual.respuestas.length,88)
  assert.equal(actual.intento_preguntas.length,90)
  assert.equal(log.some(l=>l.tabla==='preguntas'),false)
  await assert.rejects(cargarDatosSesion(cliente(datos),etapa,'ajena'),/no pertenece/)
})

test('el listado de sesiones omite snapshots y las consultas del ranking no piden textos privados',async()=>{
  const {cargarResumenEtapa}=await import('../src/lib/etapas.js')
  const {ejemploEfesios}=await import('../scripts/lib/ejemplo-efesios.mjs')
  const {etapa,datos}=ejemploEfesios()
  const log=[]
  await cargarResumenEtapa(cliente(datos,log),etapa,null,'sesiones')
  assert.equal(log.some(l=>['intentos','intento_preguntas','preguntas'].includes(l.tabla)),false)
  const rankLog=[]
  await cargarResumenEtapa(cliente(datos,rankLog),etapa)
  for(const l of rankLog.filter(l=>['respuestas','intento_preguntas','eventos_sesion'].includes(l.tabla))){
    assert.notEqual(l.columnas,'*')
    assert.equal(l.columnas.includes('respuesta_dada'),false)
    assert.equal(l.columnas.includes('respuesta_correcta'),false)
    assert.equal(l.columnas.includes('texto'),false)
  }
})
