import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import {
  adminClaims, applyMigrations, asRole, createTestDatabase, migrationPaths,
} from '../scripts/lib/local-database.mjs'

test('etapas: historial, permisos y cierre en PostgreSQL local', async t => {
  const db = await createTestDatabase()
  const ids = Object.fromEntries(['sociedad', 'pregunta', 'sesion', 'participante'].map(name => [name, randomUUID()]))
  try {
    await db.exec(await readFile((await migrationPaths())[0], 'utf8'))
    await db.query('INSERT INTO public.sociedades (id,nombre,iglesia) VALUES ($1,$2,$3)', [ids.sociedad, 'Sociedad de prueba', 'Iglesia de prueba'])
    await db.query("INSERT INTO public.preguntas (id,tipo,texto,respuesta_correcta,puntaje) VALUES ($1,'multiple','Pregunta histórica de prueba','A',10)", [ids.pregunta])
    await db.query("INSERT INTO public.sesiones (id,sociedad_id,estado,finalizado_at,cantidad_preguntas) VALUES ($1,$2,'finalizado',now(),45)", [ids.sesion, ids.sociedad])
    await db.query("INSERT INTO public.participantes (id,sesion_id,nombre,examen_finalizado,puntaje_total) VALUES ($1,$2,'Participante de prueba',true,20)", [ids.participante, ids.sesion])
    for (let i = 0; i < 2; i++) await db.query("INSERT INTO public.respuestas (participante_id,pregunta_id,respuesta_dada,puntaje_obtenido,calificado_por) VALUES ($1,$2,'A',10,'sistema')", [ids.participante, ids.pregunta])
    await db.query("INSERT INTO public.eventos_sesion (participante_id,sesion_id,tipo) VALUES ($1,$2,'cambio_pestana')", [ids.participante, ids.sesion])
    await applyMigrations(db, { existingV1: true, through: '20261020193925' })

    const stages = (await db.query('SELECT * FROM public.etapas ORDER BY numero')).rows
    const [hebreos, efesios] = stages
    const admin = action => asRole(db, 'authenticated', adminClaims, action)

    await t.test('crea Hebreos cerrada y Efesios en borrador sin mezclar bancos', async () => {
      assert.deepEqual(stages.map(e => [e.libro, e.estado]), [['Hebreos', 'cerrada'], ['Efesios', 'borrador']])
      assert.equal((await db.query('SELECT etapa_id FROM public.preguntas')).rows[0].etapa_id, hebreos.id)
      assert.equal((await db.query('SELECT etapa_id FROM public.sesiones')).rows[0].etapa_id, hebreos.id)
      assert.equal((await db.query('SELECT count(*)::int AS n FROM public.preguntas WHERE etapa_id=$1', [efesios.id])).rows[0].n, 0)
    })

    await t.test('preserva duplicados y notas originales en el archivo', async () => {
      const archive = (await db.query("SELECT contenido->'datos' AS datos FROM public.archivos_etapa WHERE etapa_id=$1", [hebreos.id])).rows[0].datos
      assert.equal(archive.respuestas.length, 2)
      assert.equal(archive.participantes[0].puntaje_total, 20)
      assert.equal(archive.sesiones[0].etapa_id, undefined)
    })

    await t.test('anon no puede leer preguntas, respuestas ni archivos', async () => {
      await asRole(db, 'anon', {}, async () => {
        for (const table of ['preguntas', 'respuestas', 'participantes', 'archivos_etapa', 'etapas', 'resumen_alertas']) {
          await assert.rejects(db.query(`SELECT * FROM public.${table}`), { code: '42501' })
        }
      })
    })

    await t.test('un usuario común o un rol en user_metadata no concede administración', async () => {
      for (const claims of [{ sub: randomUUID() }, { sub: randomUUID(), user_metadata: { role: 'admin' } }, { app_metadata: { role: 'admin' } }]) {
        await asRole(db, 'authenticated', claims, async () => {
          assert.equal((await db.query('SELECT * FROM public.etapas')).rows.length, 0)
          await assert.rejects(db.query("INSERT INTO public.etapas (codigo,nombre,libro,anio,numero) VALUES ('no','No','No',2026,9)"), { code: '42501' })
        })
      }
    })

    await t.test('el administrador puede consultar el historial sin permiso TRUNCATE', async () => {
      await admin(async () => {
        assert.equal((await db.query('SELECT * FROM public.archivos_etapa')).rows.length, 1)
        assert.equal((await db.query("SELECT has_table_privilege(current_user, 'public.respuestas', 'TRUNCATE') AS allowed")).rows[0].allowed, false)
      })
    })

    await t.test('bloquea modificación, borrado e inserción en datos históricos', async () => {
      const statements = [
        ["UPDATE public.sesiones SET estado='esperando' WHERE id=$1", ids.sesion],
        ['UPDATE public.preguntas SET puntaje=999 WHERE id=$1', ids.pregunta],
        ['UPDATE public.participantes SET puntaje_total=999 WHERE id=$1', ids.participante],
        ['UPDATE public.respuestas SET puntaje_obtenido=999 WHERE participante_id=$1', ids.participante],
        ['DELETE FROM public.eventos_sesion WHERE participante_id=$1', ids.participante],
      ]
      await admin(async () => {
        for (const [sql, id] of statements) await assert.rejects(db.query(sql, [id]), /etapa está cerrada/)
        await assert.rejects(db.query("INSERT INTO public.respuestas (participante_id,pregunta_id,respuesta_dada) VALUES ($1,$2,'A')", [ids.participante, ids.pregunta]), /etapa está cerrada/)
        await assert.rejects(db.query("UPDATE public.etapas SET estado='borrador',cerrado_at=NULL WHERE id=$1", [hebreos.id]), /no se puede modificar ni reabrir/)
      })
    })

    await t.test('no permite mover registros históricos a otra etapa', async () => {
      await admin(() => assert.rejects(db.query('UPDATE public.sesiones SET etapa_id=$1 WHERE id=$2', [efesios.id, ids.sesion]), /identidad o etapa/))
    })

    await t.test('el archivo es inmutable incluso para el propietario de la tabla', async () => {
      await assert.rejects(db.query("UPDATE public.archivos_etapa SET contenido='{}'::jsonb"), /histórico es inmutable/)
      await assert.rejects(db.query('DELETE FROM public.archivos_etapa'), /histórico es inmutable/)
    })

    await t.test('renombrar una sociedad compartida conserva su nombre histórico', async () => {
      await admin(() => db.query("UPDATE public.sociedades SET nombre='Nombre nuevo de prueba' WHERE id=$1", [ids.sociedad]))
      const original = (await db.query("SELECT contenido->'datos'->'sociedades'->0->>'nombre' AS nombre FROM public.archivos_etapa WHERE etapa_id=$1", [hebreos.id])).rows[0].nombre
      assert.equal(original, 'Sociedad de prueba')
    })

    await t.test('bloquea activar Efesios sin suficientes preguntas', async () => {
      await admin(() => assert.rejects(db.query("UPDATE public.etapas SET estado='activa' WHERE id=$1", [efesios.id]), /Faltan preguntas/))
    })

    await t.test('no se puede saltar la preparación insertando una etapa ya activa', async () => {
      await admin(() => assert.rejects(db.query("INSERT INTO public.etapas (codigo,nombre,libro,anio,numero,estado) VALUES ('atajo','Atajo','Prueba',2026,3,'activa')"), /crearse en borrador/))
    })

    const newSession = randomUUID()
    const otherSession = randomUUID()
    const newParticipant = randomUUID()
    const newQuestion = randomUUID()
    await admin(async () => {
      await db.query('UPDATE public.etapas SET cantidad_preguntas=2 WHERE id=$1', [efesios.id])
      for (const id of [newQuestion, randomUUID()]) await db.query("INSERT INTO public.preguntas (id,etapa_id,tipo,texto,respuesta_correcta,puntaje) VALUES ($1,$2,'multiple','Pregunta sintética de Efesios','A',10)", [id, efesios.id])
      for (const id of [newSession, otherSession]) await db.query("INSERT INTO public.sesiones (id,etapa_id,sociedad_id,estado) VALUES ($1,$2,$3,'esperando')", [id, efesios.id, ids.sociedad])
      await db.query("INSERT INTO public.participantes (id,sesion_id,nombre) VALUES ($1,$2,'Participante sintético de Efesios')", [newParticipant, newSession])
    })

    await t.test('una sesión no puede comenzar mientras su etapa esté en borrador', async () => {
      await admin(() => assert.rejects(db.query("UPDATE public.sesiones SET estado='activo' WHERE id=$1", [newSession]), /Activa la etapa/))
    })

    await t.test('activa Efesios y bloquea cambios posteriores en reglas y tiempo', async () => {
      await admin(async () => {
        await db.query("UPDATE public.etapas SET estado='activa' WHERE id=$1", [efesios.id])
        await db.query("UPDATE public.sesiones SET estado='activo' WHERE id=$1", [newSession])
        await assert.rejects(db.query('UPDATE public.etapas SET tiempo_limite=120 WHERE id=$1', [efesios.id]), /configuración del examen queda fija/)
        await assert.rejects(db.query("UPDATE public.etapas SET estado='borrador' WHERE id=$1", [efesios.id]), /no puede volver a borrador/)
      })
    })

    await t.test('impide mezclar una pregunta de Hebreos con un participante de Efesios', async () => {
      await admin(() => assert.rejects(db.query("INSERT INTO public.respuestas (participante_id,pregunta_id,respuesta_dada) VALUES ($1,$2,'A')", [newParticipant, ids.pregunta]), /etapas diferentes/))
    })

    await t.test('un evento debe pertenecer a la misma sesión del participante', async () => {
      await admin(() => assert.rejects(db.query("INSERT INTO public.eventos_sesion (participante_id,sesion_id,tipo) VALUES ($1,$2,'cambio_pestana')", [newParticipant, otherSession]), /sesión del participante/))
    })

    await t.test('el cierre exige terminar todas las sesiones', async () => {
      await admin(() => assert.rejects(db.query("UPDATE public.etapas SET estado='cerrada' WHERE id=$1", [efesios.id]), /Finaliza todas las sesiones/))
    })

    await t.test('el cierre exige calificar las respuestas pendientes', async () => {
      await admin(async () => {
        await db.query("UPDATE public.sesiones SET estado='finalizado',finalizado_at=now() WHERE etapa_id=$1", [efesios.id])
        await db.query("INSERT INTO public.respuestas (participante_id,pregunta_id,respuesta_dada,puntaje_obtenido,calificado_por) VALUES ($1,$2,'Texto de prueba',NULL,'pendiente_ia')", [newParticipant, newQuestion])
        await assert.rejects(db.query("UPDATE public.etapas SET estado='cerrada' WHERE id=$1", [efesios.id]), /pendientes de calificación/)
      })
    })

    await t.test('el cierre crea un archivo filtrado por etapa y hace inmutable Efesios', async () => {
      await admin(async () => {
        await db.query("UPDATE public.respuestas SET puntaje_obtenido=10,calificado_por='manual' WHERE participante_id=$1", [newParticipant])
        await db.query("UPDATE public.etapas SET estado='cerrada' WHERE id=$1", [efesios.id])
        const archive = (await db.query("SELECT contenido->'datos' AS datos FROM public.archivos_etapa WHERE etapa_id=$1", [efesios.id])).rows[0].datos
        assert.equal(archive.sesiones.length, 2)
        assert.equal(archive.respuestas.length, 1)
        assert.equal(archive.preguntas.length, 2)
        assert.equal(archive.participantes[0].id, newParticipant)
        await assert.rejects(db.query('DELETE FROM public.respuestas WHERE participante_id=$1', [newParticipant]), /etapa está cerrada/)
      })
    })

    await t.test('RLS cubre las ocho tablas y la vista usa permisos del consultante', async () => {
      const relations = (await db.query("SELECT relname,relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'")).rows
      assert.equal(relations.length, 8)
      assert.ok(relations.every(table => table.relrowsecurity))
      assert.ok((await db.query("SELECT reloptions FROM pg_class WHERE oid='public.resumen_alertas'::regclass")).rows[0].reloptions.includes('security_invoker=true'))
      assert.equal((await db.query("SELECT has_function_privilege('authenticated','app_private.archivar_cierre()','EXECUTE') AS allowed")).rows[0].allowed, false)
    })

    await t.test('todas las claves foráneas tienen índices de apoyo', async () => {
      const missing = (await db.query(`SELECT conname FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
        WHERE n.nspname='public' AND c.contype='f' AND NOT EXISTS (
          SELECT 1 FROM pg_index i WHERE i.indrelid=c.conrelid AND i.indkey[0]=c.conkey[1]
        )`)).rows
      assert.deepEqual(missing, [])
    })
  } finally {
    await db.close()
  }
})

test('una base vacía puede aplicar todo el historial de migraciones', async () => {
  const db = await createTestDatabase()
  try {
    assert.equal((await applyMigrations(db)).length, (await migrationPaths()).length)
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.etapas')).rows[0].n, 2)
  } finally {
    await db.close()
  }
})

test('si V1 tiene una sesión abierta, la migración se revierte completa', async () => {
  const db = await createTestDatabase()
  try {
    await db.exec(await readFile((await migrationPaths())[0], 'utf8'))
    await db.query("INSERT INTO public.sesiones (estado) VALUES ('activo')")
    await assert.rejects(applyMigrations(db, { existingV1: true, through: '20261020193925' }), /sesiones sin finalizar/)
    assert.equal((await db.query("SELECT to_regclass('public.etapas') AS tabla")).rows[0].tabla, null)
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.sesiones')).rows[0].n, 1)
    assert.equal((await db.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='public' AND table_name='sesiones' AND column_name='etapa_id'")).rows[0].n, 0)
  } finally {
    await db.close()
  }
})
