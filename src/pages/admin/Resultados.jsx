import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Download, FileText, Trophy } from 'lucide-react'
import { useEtapa } from '../../context/etapa-context'
import { cargarDatosSesion, datosVigentes, participantesSesion, puntajeSesion, respuestasParticipante, sesionConSociedad } from '../../lib/etapas'
import { supabase } from '../../lib/supabase'
import NavAdmin from '../../components/NavAdmin'
import EtapaAviso from '../../components/EtapaAviso'
import DialogoEtapa from '../../components/DialogoEtapa'

export default function Resultados() {
  const { id } = useParams()
  const { etapa, archivo, soloLectura } = useEtapa()
  const [estado, setEstado] = useState({ datos: null, error: '' })
  const [exportando, setExportando] = useState('')
  const [errorPdf, setErrorPdf] = useState('')
  const [seleccion, setSeleccion] = useState(null)
  const [motivo, setMotivo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [errorCambio, setErrorCambio] = useState('')
  const [aviso, setAviso] = useState('')
  useEffect(() => {
    let vigente = true
    cargarDatosSesion(supabase, etapa, id, archivo).then(datos => {
      sesionConSociedad(datos, id)
      if (vigente) setEstado({ datos, error: '' })
    }).catch(err => { if (vigente) setEstado({ datos: null, error: err.message }) })
    return () => { vigente = false }
  }, [id, etapa, archivo])
  const datos = estado.datos
  const sesion = datos ? sesionConSociedad(datos, id) : null
  const participantes = datos ? participantesSesion(datos, id) : []
  const estadisticas = datos ? puntajeSesion(datosVigentes(datos), id) : null
  const puedeCambiar = etapa.codigo === '2026-02-efesios' && !soloLectura && sesion?.estado === 'finalizado'
  const restaurando = Boolean(seleccion?.excluido_resultados_at)
  const accion = restaurando ? 'Restaurar en resultados' : 'Excluir de resultados'
  function seleccionar(participante) {
    setSeleccion(participante)
    setMotivo('')
    setErrorCambio('')
    setAviso('')
  }
  async function guardarCambio(e) {
    e.preventDefault()
    if (!seleccion || guardando || motivo.trim().length < 5) return
    setGuardando(true)
    setErrorCambio('')
    try {
      const { data, error } = await supabase.rpc('admin_participante_exclusion', {
        p_sesion: id, p_participante: seleccion.id, p_excluir: !restaurando, p_motivo: motivo.trim(),
      })
      if (error) throw error
      setEstado(actual => ({ ...actual, datos: { ...actual.datos, participantes: actual.datos.participantes.map(p =>
        p.id === seleccion.id ? { ...p, ...data } : p) } }))
      setAviso(restaurando ? 'Intento restaurado en los resultados.' : 'Intento excluido de los resultados.')
      setSeleccion(null)
    } catch (err) { setErrorCambio(err.message) }
    finally { setGuardando(false) }
  }
  async function exportar(participante) {
    if (!sesion || exportando) return
    setExportando(participante?.id || 'sesion')
    setErrorPdf('')
    try {
      const { generarReporteResultados, generarReporteIndividual } = await import('../../lib/pdf')
      const base = {
        etapa: { ...etapa, tiempo_limite: sesion.tiempo_limite, cantidad_preguntas: sesion.cantidad_preguntas },
        sesion: { sociedad: sesion.sociedades?.nombre || 'Sociedad', iglesia: sesion.sociedades?.iglesia || '', fecha: sesion.created_at },
      }
      if (participante) {
        await generarReporteIndividual({ ...base, participante, respuestas: respuestasParticipante(datos, participante.id), nombreArchivo: `Examen_${etapa.codigo}_${participante.nombre.replace(/\s+/g, '_')}.pdf` })
      } else {
        await generarReporteResultados({ ...base, estadisticas, participantes: participantes.filter(p => !p.excluido_resultados_at), nombreArchivo: `Resultados_${etapa.codigo}_${sesion.sociedades?.nombre?.replace(/\s+/g, '_') || id}.pdf` })
      }
    } catch (err) { setErrorPdf('No se pudo exportar el informe: ' + err.message) }
    finally { setExportando('') }
  }
  return <><NavAdmin /><main className="admin-content">
    <EtapaAviso />
    <div className="etapa-heading"><div><p className="eyebrow">{soloLectura ? 'Resultados archivados' : 'Resultados de la sesión'}</p><h1>{sesion?.sociedades?.nombre || 'Resultados'}</h1><Link to="/admin/dashboard">Volver a las sesiones</Link></div><div className="etapa-actions"><Link className="btn btn-secondary" to="/admin/ranking"><Trophy size={17} />Ranking de la etapa</Link><button className="btn btn-primary" onClick={() => exportar()} disabled={!sesion || Boolean(exportando)}><Download size={17} />{exportando === 'sesion' ? 'Exportando…' : 'Exportar PDF'}</button></div></div>
    {(estado.error || errorPdf) && <p role="alert" className="alert alert-error">{estado.error || errorPdf}</p>}
    {!datos && !estado.error ? <p role="status">Cargando resultados…</p> : estadisticas && <>
      <section className="card" style={{ marginBottom: 24, padding: 28 }}>
        <p className="eyebrow">{estadisticas.pendientesIA ? 'Resultado provisional · hay calificaciones pendientes' : 'Resumen de la sesión'}</p>
        <dl className="etapa-stats"><div><dt>{etapa.historica ? 'Efectividad con criterios V1' : 'Efectividad de la sesión'}</dt><dd>{estadisticas.porcentaje.toFixed(2)} / 100</dd></div><div><dt>Puntos registrados</dt><dd>{estadisticas.puntajeObtenido} / {estadisticas.puntajeMaximo}</dd></div><div><dt>Participantes</dt><dd>{estadisticas.rindieron}</dd></div><div><dt>Alertas registradas</dt><dd>{estadisticas.totalAlertas}</dd></div></dl>
        <p className="etapa-help">{soloLectura ? 'Los puntajes guardados y las respuestas originales se muestran sin corregir ni depurar.' : 'El máximo incluye todas las preguntas asignadas, incluso las no respondidas. La clasificación queda sujeta a la revisión de las respuestas pendientes.'}</p>
        {!soloLectura && estadisticas.pendientesIA > 0 && <Link className="btn btn-secondary" to={`/admin/sesion/${id}/calificar`}>Revisar {estadisticas.pendientesIA} respuestas pendientes</Link>}
      </section>
      <section className="card" style={{ padding: 24 }}><h2 style={{ fontSize: '1.2rem', marginBottom: 18 }}>Resultados por joven</h2>
        {aviso && <p role="status">{aviso}</p>}
        {participantes.length === 0 ? <p>Esta sesión no tiene participantes.</p> : <div className="tabla-scroll">
          <table className="etapa-results-table">
            <thead><tr><th scope="col">Participante</th><th scope="col">Nota / 100</th><th scope="col">Puntaje guardado</th><th scope="col">Máximo registrado</th><th scope="col">Respuestas</th><th scope="col">Estado</th><th scope="col">Alertas</th><th scope="col">Informe</th>{puedeCambiar && <th scope="col">Acciones</th>}</tr></thead>
            <tbody>{participantes.map(p => <tr key={p.id}>
              <th scope="row">{p.nombre}</th>
              <td>{p.puntaje_max ? (100 * (p.puntaje_total || 0) / p.puntaje_max).toFixed(2) : '—'}</td>
              <td>{p.puntaje_total || 0}</td><td>{p.puntaje_max}</td><td>{p.respondidas}</td>
              <td>{p.excluido_resultados_at ? <><strong>Excluido</strong><small style={{ whiteSpace: 'normal' }}>{p.motivo_exclusion}</small></> :
                p.pendientes ? `${p.pendientes} pendientes` : p.examen_finalizado ? 'Finalizado' : 'Sin finalizar'}</td>
              <td>{p.alertas}</td>
              <td>{p.excluido_resultados_at ? '—' : <button className="btn btn-secondary" onClick={() => exportar(p)} disabled={Boolean(exportando)} aria-label={`Exportar informe de ${p.nombre}`}><FileText size={16} />{exportando === p.id ? 'Exportando…' : 'PDF'}</button>}</td>
              {puedeCambiar && <td><button className="btn btn-secondary" onClick={() => seleccionar(p)}>{p.excluido_resultados_at ? 'Restaurar' : 'Excluir'}</button></td>}
            </tr>)}</tbody>
          </table></div>}
      </section>
    </>}
    {seleccion && <DialogoEtapa bloqueado={guardando} onClose={() => setSeleccion(null)}>
      <h2 id="confirmar-etapa-titulo">{accion}</h2>
      <p><strong>{seleccion.nombre}</strong> · {seleccion.respondidas} respuestas guardadas · {seleccion.puntaje_total || 0} / {seleccion.puntaje_max} puntos</p>
      <p>{restaurando ? 'El intento volverá a contar en el promedio, la clasificación y los informes de Efesios.' : 'El intento quedará fuera del promedio, la clasificación y los informes de Efesios. Sus respuestas se conservan y podrás restaurarlo.'}</p>
      <form onSubmit={guardarCambio}>
        <label className="form-label">Motivo<textarea className="form-input" value={motivo} minLength={5} maxLength={500} onChange={e => setMotivo(e.target.value)} required disabled={guardando} /></label>
        {errorCambio && <p role="alert" className="alert alert-error">{errorCambio}</p>}
        <div className="etapa-actions"><button type="button" className="btn btn-secondary" onClick={() => setSeleccion(null)} disabled={guardando}>Cancelar</button><button className="btn btn-primary" disabled={guardando || motivo.trim().length < 5}>{guardando ? 'Guardando…' : accion}</button></div>
      </form>
    </DialogoEtapa>}
  </main></>
}
