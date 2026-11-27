import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createTestDatabase, applyMigrations, asRole, adminClaims } from '../scripts/lib/local-database.mjs'

test('el enlace concede moderación de una sola sala y pierde acceso al cierre o revocación', async () => {
  const db = await createTestDatabase()
  try {
    await applyMigrations(db)
    const ayudante = randomUUID(), otro = randomUUID(), joven = randomUUID(), instancia = randomUUID()
    await db.query('INSERT INTO auth.users(id) VALUES ($1),($2),($3)', [ayudante, otro, joven])
    const etapa = (await db.query("SELECT id FROM public.etapas WHERE codigo='2026-02-efesios'")).rows[0].id
    const sociedad = (await db.query("INSERT INTO public.sociedades(nombre,iglesia) VALUES ('Sociedad de prueba','Iglesia de prueba') RETURNING id")).rows[0].id
    await db.query(`INSERT INTO public.preguntas(etapa_id,tipo,texto,puntaje,opciones,respuesta_correcta,rubrica) VALUES
      ($1,'multiple','Pregunta de selección',2,'["Opción A","Opción B"]','Opción A','[]'),
      ($1,'abierta','Pregunta abierta',3,null,'Referencia','[{"criterio":"Concepto","puntos":3}]'),
      ($1,'contexto','Pregunta de contexto',4,null,'Referencia','[{"criterio":"Explicación","puntos":4}]')`, [etapa])
    const rpc = (uid, nombre, ...args) => asRole(db, 'authenticated', uid === adminClaims.sub ? adminClaims : { sub: uid }, async () => {
      await db.query("SELECT set_config('request.headers',$1,false)", [JSON.stringify({ 'x-examen-instancia': instancia })])
      const marcador = args.map((_, i) => '$' + (i + 1)).join(',')
      return (await db.query(`SELECT public.${nombre}(${marcador}) AS datos`, args)).rows[0].datos
    })
    const admin = (nombre, ...args) => rpc(adminClaims.sub, nombre, ...args)
    const crear = async nombre => (await admin('admin_sesion_crear', etapa, sociedad, JSON.stringify([{ nombre }]), 60, 3)).sesion_id
    const sala = await crear('Participante uno'), ajena = await crear('Participante ajeno')
    const negar = { code: '42501' }

    await assert.rejects(rpc(ayudante, 'admin_examen_sala', sala, etapa), negar)
    const { codigo } = await admin('admin_moderacion_enlace', sala, false)
    assert.match(codigo, /^[a-f0-9]{64}$/)
    await assert.rejects(rpc(otro, 'moderacion_entrar', ajena, codigo), negar)
    assert.equal((await rpc(ayudante, 'moderacion_entrar', sala, codigo)).id, etapa)
    await assert.rejects(rpc(otro, 'moderacion_entrar', sala, codigo), negar)
    await assert.rejects(rpc(ayudante, 'admin_examen_sala', ajena, etapa), negar)
    await assert.rejects(rpc(ayudante, 'admin_moderacion_enlace', sala, false), negar)
    await assert.rejects(rpc(ayudante, 'admin_examen_agregar', ajena, 'Ajeno'), negar)
    await assert.rejects(rpc(ayudante, 'admin_sesion_eliminar', sala, etapa, 'ELIMINAR'), negar)
    await assert.rejects(rpc(ayudante, 'moderacion_estado', sala, 'activo'), /al menos un participante/)

    const registro = await rpc(joven, 'examen_sala', sala)
    const { intento } = await rpc(joven, 'examen_registrar', sala, registro.participantes[0].id)
    await rpc(ayudante, 'moderacion_estado', sala, 'activo')
    assert.ok((await rpc(joven, 'examen_estado', intento.id)).pregunta)
    assert.ok(await rpc(ayudante, 'moderacion_incidencias', intento.id))
    assert.ok((await rpc(ayudante, 'admin_examen_sala', sala, etapa)).participantes.every(p => !('puntaje_total' in p) && !('seed' in p)))
    const visibles = await asRole(db, 'authenticated', { sub: ayudante }, () => db.query('SELECT count(*)::int AS total FROM public.intento_preguntas'))
    assert.equal(visibles.rows[0].total, 0)
    await rpc(ayudante, 'admin_examen_agregar', sala, 'Otro participante')
    await rpc(ayudante, 'moderacion_estado', sala, 'finalizado')
    await assert.rejects(rpc(ayudante, 'admin_examen_sala', sala, etapa), negar)
    await assert.rejects(rpc(ayudante, 'moderacion_incidencias', intento.id), negar)
    await assert.rejects(rpc(ayudante, 'admin_examen_justificar', intento.id, 'Fuera de la sala'), negar)
    await assert.rejects(admin('admin_moderacion_enlace', sala, false), negar)
    assert.equal((await admin('admin_examen_sala', sala, etapa)).sesion.estado, 'finalizado')

    const segundo = await admin('admin_moderacion_enlace', ajena, false)
    await rpc(ayudante, 'moderacion_entrar', ajena, segundo.codigo)
    await admin('admin_moderacion_enlace', ajena, true)
    await assert.rejects(rpc(ayudante, 'admin_examen_sala', ajena, etapa), negar)
    const tercero = await admin('admin_moderacion_enlace', ajena, false)
    await db.query("UPDATE app_private.invitaciones_moderacion SET vence_at=now()-interval '1 second' WHERE codigo_hash=sha256(convert_to($1,'UTF8'))", [tercero.codigo])
    await assert.rejects(rpc(ayudante, 'moderacion_entrar', ajena, tercero.codigo), negar)
  } finally {
    await db.close()
  }
})
