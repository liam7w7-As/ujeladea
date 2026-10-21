import { parseArgs } from 'node:util'
import { writeFile } from 'node:fs/promises'
import {
  applyMigrations, assertOriginalData, createTestDatabase, loadVerifiedBackup,
} from './lib/local-database.mjs'

const { values } = parseArgs({ options: {
  'backup-dir': { type: 'string' },
  report: { type: 'string' },
} })
const backupDirectory = values['backup-dir'] || process.env.HEBREOS_BACKUP_DIR
if (!backupDirectory) {
  console.error('Uso: npm run db:verify-backup -- --backup-dir RUTA [--report RUTA_JSON]')
  process.exitCode = 1
} else {
  let db
  try {
    const backup = await loadVerifiedBackup(backupDirectory)
    db = await createTestDatabase()
    const version = (await db.query('SELECT version() AS version')).rows[0].version
    await restoreAndCheck()

    async function restoreAndCheck() {
      const { restoreBackup } = await import('./lib/local-database.mjs')
      await restoreBackup(db, backup)
      const before = await assertOriginalData(db, backup.snapshot)
      const applied = await applyMigrations(db, { existingV1: true })
      const after = await assertOriginalData(db, backup.snapshot)
      const archive = (await db.query(`SELECT a.contenido->'datos' AS datos FROM public.archivos_etapa a
        JOIN public.etapas e ON e.id=a.etapa_id WHERE e.codigo='2026-01-hebreos'`)).rows[0]
      const { isDeepStrictEqual } = await import('node:util')
      if (!isDeepStrictEqual(archive?.datos, backup.snapshot.data)) throw new Error('El archivo histórico difiere del respaldo')
      const report = {
        verified_at: new Date().toISOString(),
        source_project: backup.manifest.project,
        source_capture: backup.manifest.captured_at,
        engine: version,
        isolation: 'Local, en memoria, sin conexiones al proyecto de producción',
        full_supabase_stack_tested: false,
        backup_integrity_verified: true,
        postgres_restore_tested: true,
        original_data_unchanged_after_migration: true,
        archive_matches_original_backup: true,
        counts_before: before,
        counts_after: after,
        migrations: applied,
        stages: (await db.query('SELECT codigo, libro, estado FROM public.etapas ORDER BY numero')).rows,
      }
      if (values.report) await writeFile(values.report, JSON.stringify(report, null, 2) + '\n', 'utf8')
      console.log(JSON.stringify(report, null, 2))
    }
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  } finally {
    await db?.close()
  }
}
