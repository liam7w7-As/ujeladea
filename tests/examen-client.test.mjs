import test from 'node:test'
import assert from 'node:assert/strict'
import { BorradorExamen } from '../src/lib/borradores.js'
import { combinarEstado } from '../src/lib/estado-examen.js'
import { puntajeSesion, participantesSesion } from '../src/lib/etapas.js'

function almacen() { const valores = new Map(); return { getItem: k => valores.get(k) || null, setItem: (k,v) => valores.set(k,v), removeItem: k => valores.delete(k) } }
function dto(q, respondidas = 0) { return { version: 2, servidor_at: '2026-10-21T16:00:00Z', sesion: { id: 's' }, intento: { id: 'i', estado: 'en_curso', respondidas }, pregunta: q } }
const pregunta = { id: 'q', posicion: 20, borrador: '', revision: 0 }
function gestor(t, opciones = {}) {
  const storage = opciones.storage || almacen()
  const g = new BorradorExamen({ intento: 'i', pregunta, storage, onEstado: () => {}, demora: 60000, uuid: () => 'misma-solicitud', ...opciones })
  g.iniciar()
  t.after(() => g.destruir())
  return { g, storage }
}
test('un borrador se persiste antes de enviar y se recupera aunque el servidor no haya recibido texto', t => {
  const { g, storage }=gestor(t)
  g.cambiar('Respuesta en pregunta 20')
  const recuperado=gestor(t,{storage}).g
  assert.equal(recuperado.getSnapshot().texto,'Respuesta en pregunta 20')
  assert.equal(recuperado.getSnapshot().estado,'local')
})
test('un fallo de red conserva la respuesta y no avanza la pregunta', async t => {
  let estados=0
  const {g,storage}=gestor(t,{api:{borrador:async()=>{throw new Error('Sin red')}},onEstado:()=>estados++})
  g.cambiar('Texto sin conexión')
  await g.guardar()
  assert.equal(estados,0)
  assert.equal(g.getSnapshot().texto,'Texto sin conexión')
  assert.equal(g.getSnapshot().estado,'error')
  assert.equal(JSON.parse(storage.getItem(g.key)).texto,'Texto sin conexión')
})
test('la escritura durante un envío no se sustituye por el borrador anterior al llegar la confirmación', async t => {
  let resolver
  const envio=new Promise(r=>{resolver=r})
  const {g}=gestor(t,{api:{borrador:()=>envio}})
  g.cambiar('Primera versión')
  const guardado=g.guardar()
  await Promise.resolve()
  g.cambiar('Segunda versión')
  resolver(dto({...pregunta,borrador:'Primera versión',revision:1},19))
  await guardado
  assert.equal(g.getSnapshot().texto,'Segunda versión')
  assert.equal(g.getSnapshot().estado,'local')
  assert.equal(g.revision,1)
})
test('dos clics de confirmación realizan un solo envío', async t => {
  let llamadas=0
  const {g}=gestor(t,{api:{responder:async()=>{llamadas++;return dto({id:'siguiente',revision:0},20)}}})
  g.cambiar('Respuesta confirmada')
  await Promise.all([g.confirmar(),g.confirmar()])
  assert.equal(llamadas,1)
})
test('perder la confirmación bloquea cambios y reintenta con el mismo identificador tras recargar', async t => {
  let llamadas=0
  const ids=[]
  const api={responder:async(_i,_q,_texto,id)=>{
    ids.push(id)
    if(++llamadas===1)throw new Error('Se perdió la confirmación')
    return dto({id:'siguiente',revision:0},20)
  }}
  const {g,storage}=gestor(t,{api})
  g.cambiar('Texto original')
  await g.confirmar()
  assert.equal(g.getSnapshot().estado,'pendiente')
  g.cambiar('Cambio después del envío')
  assert.equal(g.getSnapshot().texto,'Texto original')
  g.destruir()
  const recuperado=gestor(t,{api,storage}).g
  assert.equal(recuperado.getSnapshot().estado,'pendiente')
  await recuperado.reintentar()
  assert.deepEqual(ids,['misma-solicitud','misma-solicitud'])
  assert.equal(storage.getItem(g.key),null)
})
test('un conflicto de pestañas requiere elegir el texto y conserva ambas versiones',async t=>{
  const api={
    borrador:async()=>{const error=new Error('Conflicto');error.code='40001';throw error},
    estado:async()=>dto({...pregunta,borrador:'Versión remota',revision:2},19),
  }
  const {g}=gestor(t,{api})
  g.cambiar('Versión de esta pantalla')
  await g.guardar()
  assert.equal(g.getSnapshot().estado,'conflicto')
  assert.equal(g.getSnapshot().texto,'Versión de esta pantalla')
  assert.equal(g.remoto,'Versión remota')
  g.usarGuardado()
  assert.equal(g.getSnapshot().texto,'Versión remota')
})
test('la confirmación recibida mientras se guarda un borrador sigue bloqueada hasta que termina el envío',async t=>{
  let resolver,confirmar
  const draft=new Promise(r=>{resolver=r})
  const respuesta=new Promise(r=>{confirmar=r})
  const {g}=gestor(t,{api:{borrador:()=>draft,responder:()=>respuesta}})
  g.cambiar('Respuesta')
  const guardado=g.guardar()
  await Promise.resolve()
  const envio=g.confirmar()
  resolver(dto({...pregunta,borrador:'Respuesta',revision:1},19))
  await guardado
  assert.equal(g.getSnapshot().estado,'enviando')
  g.cambiar('No debe cambiar')
  assert.equal(g.getSnapshot().texto,'Respuesta')
  confirmar(dto({id:'siguiente',revision:0},20))
  await envio
})
test('un almacenamiento dañado no sustituye el borrador confirmado y no impide el guardado remoto',async t=>{
  const storage={getItem:()=>'{roto',setItem:()=>{throw new Error('Sin espacio')},removeItem:()=>{}}
  const {g}=gestor(t,{storage,pregunta:{...pregunta,borrador:'Servidor',revision:3},api:{borrador:async()=>dto({...pregunta,borrador:'Nuevo',revision:4},19)}})
  assert.equal(g.getSnapshot().texto,'Servidor')
  g.cambiar('Nuevo')
  assert.equal(g.getSnapshot().localDisponible,false)
  await g.guardar()
  assert.equal(g.getSnapshot().estado,'guardado')
})
test('un resultado antiguo de red no revierte la numeración ni un intento terminado',()=>{
  const actual=dto({id:'actual',posicion:20,revision:2},19)
  assert.equal(combinarEstado(actual,dto({id:'anterior',posicion:1,revision:0},0)),actual)
  assert.equal(combinarEstado(actual,dto({id:'actual',posicion:20,revision:1},19)),actual)
  const final={...actual,intento:{...actual.intento,estado:'finalizado'}}
  assert.equal(combinarEstado(final,actual),final)
})
test('el máximo V2 incluye preguntas sin responder y usa snapshots aunque cambie el banco',()=>{
  const datos={
    sesiones:[{id:'s',sociedad_id:'soc',estado:'finalizado'}],sociedades:[{id:'soc',nombre:'Prueba'}],
    participantes:[{id:'p',sesion_id:'s',puntaje_total:10}],intentos:[{id:'i',participante_id:'p'}],
    intento_preguntas:[{id:'a',intento_id:'i',puntaje:10},{id:'b',intento_id:'i',puntaje:20}],
    preguntas:[{id:'q',puntaje:999}],eventos_sesion:[],
    respuestas:[{id:'r',participante_id:'p',pregunta_id:'q',intento_pregunta_id:'a',puntaje_obtenido:10,calificado_por:'sistema'}],
  }
  assert.equal(participantesSesion(datos,'s')[0].puntaje_max,30)
  const resultado=puntajeSesion(datos,'s')
  assert.equal(resultado.puntajeMaximo,30)
  assert.equal(resultado.porcentajeBruto,33)
})

test('una confirmación antigua de borrador no sustituye un cambio remoto más reciente',async t=>{
  let resolver
  const pendiente=new Promise(r=>{resolver=r})
  const {g}=gestor(t,{api:{borrador:()=>pendiente}})
  g.cambiar('Texto de esta pantalla')
  const guardado=g.guardar()
  await Promise.resolve()
  g.sincronizar({...pregunta,borrador:'Cambio remoto posterior',revision:2})
  resolver(dto({...pregunta,borrador:'Texto de esta pantalla',revision:1},19))
  await guardado
  assert.equal(g.getSnapshot().estado,'conflicto')
  assert.equal(g.remoto,'Cambio remoto posterior')
  assert.equal(g.revision,2)
})

test('elegir el texto local tras un envío pendiente y un conflicto no deja la pantalla bloqueada',async t=>{
  const storage=almacen()
  storage.setItem('ujeladea_borrador_v2:i:q',JSON.stringify({version:2,texto:'Local',revision:0,confirmar:true,solicitud:'anterior'}))
  const {g}=gestor(t,{storage,pregunta:{...pregunta,borrador:'Remoto',revision:2},api:{borrador:async()=>dto({...pregunta,borrador:'Local',revision:3},19)}})
  assert.equal(g.getSnapshot().estado,'conflicto')
  await g.conservarLocal()
  assert.equal(g.getSnapshot().estado,'guardado')
  assert.equal(g.getSnapshot().texto,'Local')
  assert.equal(g.confirmacionPendiente,false)
})
test('una sincronización remota no cambia el texto de una confirmación pendiente',async t=>{
  const {g}=gestor(t,{pregunta:{...pregunta,borrador:'Respuesta enviada',revision:1},api:{responder:async()=>{throw new Error('Sin confirmación')}}})
  await g.confirmar()
  assert.equal(g.getSnapshot().estado,'pendiente')
  g.sincronizar({...pregunta,borrador:'Otra respuesta en otra pestaña',revision:2})
  assert.equal(g.getSnapshot().texto,'Respuesta enviada')
  assert.equal(g.getSnapshot().estado,'conflicto')
})
