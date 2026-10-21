import test from 'node:test'
import assert from 'node:assert/strict'
import { configuracionPublicaValida } from '../src/lib/configuracion.js'

const jwt = role => [Buffer.from('{}').toString('base64url'), Buffer.from(JSON.stringify({ role })).toString('base64url'), 'firma-ficticia'].join('.')
test('configuración del navegador admite solo clave publicable o anon heredada', () => {
  assert.equal(configuracionPublicaValida('https://proyecto.supabase.co', 'sb_publishable_prueba'), true)
  assert.equal(configuracionPublicaValida('http://127.0.0.1:54321', jwt('anon')), true)
  for (const key of ['sb_secret_ficticia', jwt('service_role'), jwt('authenticated'), 'clave-invalida', '', undefined]) {
    assert.equal(configuracionPublicaValida('https://proyecto.supabase.co', key), false)
  }
})
test('una URL ausente, inválida o de protocolo distinto no rompe el arranque', () => {
  for (const url of [undefined, '', 'http://', 'proyecto.supabase.co', 'file:///tmp/config', 'javascript:alert(1)']) {
    assert.equal(configuracionPublicaValida(url, 'sb_publishable_prueba'), false)
  }
})
