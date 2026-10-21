import test from 'node:test'
import assert from 'node:assert/strict'
import { prepararInformeEtapa } from '../src/lib/informe-etapa.js'
import { ejemploEfesios } from '../scripts/lib/ejemplo-efesios.mjs'

test('el informe V2 usa todas las asignaciones, separa convocados e identifica notas pendientes',()=>{
  const f=ejemploEfesios()
  const original=JSON.stringify(f)
  const i=prepararInformeEtapa(f)
  assert.equal(i.resumen.asignadas,180)
  assert.equal(i.resumen.respondidas,176)
  assert.equal(i.resumen.sinResponder,4)
  assert.equal(i.resumen.pendientes,1)
  assert.equal(i.resumen.registrados,4)
  assert.equal(i.resumen.sinRegistro,2)
  assert.equal(i.sociedades[0].puntajeMaximo,900)
  assert.equal(i.sociedades.find(s=>s.sesionId==='sesion-0').penalizacionPorcentaje,5)
  assert.equal(i.provisional,true)
  assert.equal(JSON.stringify(f),original)
})

test('un informe no presenta resultados definitivos mientras la etapa esté abierta, incluso sin notas pendientes',()=>{
  const f=ejemploEfesios({pendientes:false})
  assert.equal(prepararInformeEtapa(f).provisional,true)
  f.etapa.estado='cerrada'
  assert.equal(prepararInformeEtapa(f).provisional,false)
  f.datos.sesiones[0].estado='esperando'
  const i=prepararInformeEtapa(f)
  assert.equal(i.provisional,true)
  assert.equal(i.sociedades.length,1)
  assert.equal(i.resumen.abiertas,1)
})

test('las diferencias en totales se advierten y no se corrigen ni se ocultan en el informe',()=>{
  const f=ejemploEfesios({cerrada:true,pendientes:false})
  f.datos.participantes[0].puntaje_total+=5
  const i=prepararInformeEtapa(f)
  assert.equal(i.resumen.discrepancias,1)
  assert.equal(i.provisional,true)
  assert.match(i.motivos.join(' '),/revisión/)
  assert.equal(f.datos.participantes[0].puntaje_total,375)
})

test('los informes no contienen enunciados, referencias, respuestas ni datos internos de Auth',()=>{
  const f=ejemploEfesios()
  f.datos.intentos[0].usuario_id='uid-secreto'
  const texto=JSON.stringify(prepararInformeEtapa(f))
  for(const privado of ['Referencia privada','Texto privado','Enunciado sintético','uid-secreto','respuesta_correcta','respuesta_dada','usuario_id']) assert.equal(texto.includes(privado),false)
})

test('una mezcla de etapas, una asignación ajena o la ausencia de snapshots interrumpen el informe',()=>{
  const f=ejemploEfesios()
  for(const mutar of [
    x=>x.datos.sesiones[0].etapa_id='otra',
    x=>x.datos.intentos[0].etapa_id='otra',
    x=>x.datos.respuestas[0].intento_id='otro',
    x=>x.datos.intento_preguntas[0].intento_id='otro',
    x=>delete x.datos.intento_preguntas,
  ]){const caso=structuredClone(f);mutar(caso);assert.throws(()=>prepararInformeEtapa(caso))}
  assert.throws(()=>prepararInformeEtapa({...f,etapa:{...f.etapa,historica:true}}),/histórico/)
})

test('una base vacía produce un informe de preparación con cantidades cero, y un ejemplo siempre se etiqueta',()=>{
  const f=ejemploEfesios({sociedades:0,cerrada:true,pendientes:false})
  let i=prepararInformeEtapa(f)
  assert.deepEqual(i.sociedades,[])
  assert.equal(i.resumen.asignadas,0)
  i=prepararInformeEtapa({...f,ejemplo:true})
  assert.equal(i.provisional,true)
  assert.match(i.motivos.join(' '),/sintéticos/)
})
