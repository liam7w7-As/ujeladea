import test from 'node:test'
import assert from 'node:assert/strict'
import { separarContexto, buscarNombre, estadoGuardado, horaExamen } from '../src/lib/experiencia-examen.js'

test('el pasaje se separa solo con delimitadores explícitos y conserva el enunciado sin estructura', () => {
  const original = 'Efesios 2: explicación completa\nOtra línea que forma parte de la pregunta.'
  assert.deepEqual(separarContexto(original, 'contexto'), { contexto: '', consigna: original })
  assert.deepEqual(separarContexto('Pasaje:\nTexto de muestra\n\nPregunta:\nExplica el contexto.', 'contexto'), { contexto: 'Texto de muestra', consigna: 'Explica el contexto.' })
  assert.deepEqual(separarContexto('Contexto bíblico: Texto\nConsigna: Explica', 'contexto'), { contexto: 'Texto', consigna: 'Explica' })
  assert.equal(separarContexto('Pasaje: Texto\nPregunta: Explica', 'abierta').contexto, '')
  assert.equal(separarContexto('Pasaje:\nPregunta:', 'contexto').consigna, 'Pasaje:\nPregunta:')
})

test('buscar nombres admite tildes y diferencias de mayúsculas', () => {
  assert.equal(buscarNombre('  JOSÉ Álvarez  '), buscarNombre('jose alvarez'))
})

test('un estado de guardado no promete copia local si el navegador la rechazó', () => {
  for (const estado of ['local', 'guardando', 'error', 'pendiente']) {
    const mensaje = estadoGuardado({ estado, texto: 'Respuesta', localDisponible: false })
    assert.match(mensaje.detalle, /copia local no está disponible/)
    assert.doesNotMatch(mensaje.detalle, /borrador está en este dispositivo/)
  }
  assert.equal(estadoGuardado({ estado: 'guardado', texto: '', localDisponible: true }).titulo, 'Aún sin respuesta')
  assert.match(estadoGuardado({ estado: 'guardado', texto: 'Respuesta', localDisponible: true }).detalle, /Falta confirmar/)
  assert.match(estadoGuardado({ estado: 'pendiente', texto: 'Respuesta', localDisponible: true }).detalle, /mismo envío/)
})

test('la constancia usa la hora del servidor en Bolivia y no inventa una fecha ausente', () => {
  assert.equal(horaExamen('2026-11-08T14:30:00Z'), '10:30')
  assert.equal(horaExamen(null), '')
  assert.equal(horaExamen('fecha inválida'), '')
})
