import { PGlite } from '@electric-sql/pglite'
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { fileURLToPath } from 'node:url'

export const projectRoot = fileURLToPath(new URL('../../', import.meta.url))
export const ident = value => '"' + value.replaceAll('"', '""') + '"'

// Solo para PostgreSQL de pruebas. No instala Auth ni sustituye GoTrue.
export async function createTestDatabase() {
  const db = await PGlite.create()
  await db.exec(`
    SET TIME ZONE 'UTC';
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE
      AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      AS $$ SELECT nullif(auth.jwt()->>'sub', '')::uuid $$;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.jwt(), auth.uid() TO anon, authenticated, service_role;
  `)
  return db
}

export async function migrationPaths() {
  const directory = path.join(projectRoot, 'supabase', 'migrations')
  return (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()
    .map(name => path.join(directory, name))
}

export async function applyMigrations(db, { existingV1 = false, through } = {}) {
  const applied = []
  for (const filename of await migrationPaths()) {
    if (existingV1 && filename.endsWith('_v1_baseline.sql')) continue
    if (through && path.basename(filename).slice(0,14) > through) continue
    try {
      await db.exec(await readFile(filename, 'utf8'))
    } catch (error) {
      await db.exec('ROLLBACK')
      // eslint-disable-next-line preserve-caught-error -- El error original puede contener SQL y datos privados completos.
      throw new Error(`Falló ${path.basename(filename)} [${error.code}]: ${error.message}`, { cause: { code: error.code } })
    }
    applied.push(path.basename(filename))
  }
  return applied
}

export async function loadVerifiedBackup(directory) {
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'))
  if (manifest.project_ref !== 'hjoccttauvxbuuhifbrk') throw new Error('El respaldo no pertenece a torneo-inela')
  for (const [name, metadata] of Object.entries(manifest.files)) {
    if (path.basename(name) !== name) throw new Error('Nombre de archivo inseguro en el manifiesto')
    const bytes = await readFile(path.join(directory, name))
    if (bytes.length !== metadata.bytes || createHash('sha256').update(bytes).digest('hex') !== metadata.sha256) {
      throw new Error(`El archivo ${name} no coincide con el manifiesto`)
    }
  }
  const snapshot = JSON.parse(await readFile(path.join(directory, 'snapshot.json'), 'utf8'))
  for (const [table, count] of Object.entries(manifest.counts)) {
    if (snapshot.data[table]?.length !== count || snapshot.source_counts[table] !== count) {
      throw new Error(`Recuento incorrecto en ${table}`)
    }
  }
  return { manifest, snapshot, directory: path.resolve(directory) }
}

export async function restoreBackup(db, backup) {
  try {
    await db.exec(await readFile(path.join(backup.directory, 'restaurar_public.sql'), 'utf8'))
    await db.exec(await readFile(path.join(backup.directory, 'permisos_originales.sql'), 'utf8'))
  } catch (error) {
    await db.exec('ROLLBACK')
    // Evitar que el error muestre el SQL completo con datos personales.
    // eslint-disable-next-line preserve-caught-error -- Solo se conserva el código; el error original incluye el respaldo.
    throw new Error(`Falló la restauración local [${error.code}]: ${error.message}`, { cause: { code: error.code } })
  }
}

export async function assertOriginalData(db, snapshot) {
  const verified = {}
  for (const [table, expectedRows] of Object.entries(snapshot.data)) {
    const originalColumns = snapshot.schema.columns.filter(column => column.table === table).map(column => column.name)
    const { rows: currentColumns } = await db.query(
      'SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2',
      ['public', table],
    )
    const newColumns = currentColumns.map(column => column.column_name).filter(name => !originalColumns.includes(name))
    const result = await db.query(`SELECT to_jsonb(t) - $1::text[] AS original FROM public.${ident(table)} t ORDER BY id`, [newColumns])
    if (!isDeepStrictEqual(result.rows.map(row => row.original), expectedRows)) {
      throw new Error(`Los datos originales de ${table} cambiaron`)
    }
    verified[table] = expectedRows.length
  }
  return verified
}

export async function asRole(db, role, claims, action) {
  if (!['anon', 'authenticated', 'service_role'].includes(role)) throw new Error('Rol de prueba inválido')
  await db.query("SELECT set_config('request.jwt.claims', $1, false)", [JSON.stringify(claims)])
  await db.exec(`SET ROLE ${role}`)
  try {
    return await action()
  } finally {
    await db.exec('RESET ROLE')
    await db.query("SELECT set_config('request.jwt.claims', '{}', false)")
  }
}

export const adminClaims = {
  sub: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  app_metadata: { role: 'admin' },
}
