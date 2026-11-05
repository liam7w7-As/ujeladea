import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Brain, Save, RefreshCw, CheckCheck, HelpCircle } from 'lucide-react'
import { useEtapa } from '../../context/etapa-context'
import { useExamen } from '../../context/ExamenContext'
import useRevisionJurado from '../../hooks/useRevisionJurado'
import { criteriosRevision } from '../../lib/revision-jurado'
import NavAdmin from '../../components/NavAdmin'

const modos = [['pendientes', 'Pendientes'], ['consulta', 'Consulta'], ['revisadas', 'Segunda revisión']]
export default function CalificarSesion() {
  const { id } = useParams(), { etapa } = useEtapa(), { usuario } = useExamen(), navigate = useNavigate()
  const { estado: s, control } = useRevisionJurado(id, etapa.id, usuario?.user.id)
  const [atajos, setAtajos] = useState(false)
  const respuestaHeading = useRef(null)
  useEffect(() => {
    if (s?.item?.id) {
      respuestaHeading.current?.focus({ preventScroll: true })
      respuestaHeading.current?.scrollIntoView({ block: 'start' })
    }
  }, [s?.item?.id])
  const grupo = s?.resumen?.preguntas.find(g => g.clave === s.grupo)
  const criterios = criteriosRevision(grupo)
  const bloqueado = !s || s.ocupado || s.commitPendiente || s.conflicto
  const pendientes = s?.resumen?.preguntas.reduce((n, g) => n + g.pendientes, 0) || 0
  const consultas = s?.resumen?.preguntas.reduce((n, g) => n + g.consultas, 0) || 0
  const total = s?.puntos.reduce((n, p) => n + (p ?? 0), 0) || 0
  async function volver(e) {
    e.preventDefault()
    if (s?.commitPendiente) return
    if (await control.current?.salir()) navigate('/admin/sesion/' + id + '/resultados')
  }
  function teclado(e) {
    if (!atajos || !e.ctrlKey || e.key !== 'Enter' || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.isComposing) return
    e.preventDefault()
    void control.current?.guardar()
  }
  return <><NavAdmin/><main className="admin-content jurado" onKeyDown={teclado}>
    <div className="etapa-heading"><div><p className="eyebrow">Jurado · {etapa.libro}</p><h1>Corrección por pregunta</h1><p>{s?.resumen?.sociedad || 'Cargando sociedad…'} · Solo respuestas de esta sesión</p></div><button className="btn btn-secondary" onClick={volver} disabled={!s || s.ocupado || s.commitPendiente}>Volver a resultados</button></div>
    <p className="etapa-help">La identidad está oculta. Aplica la rúbrica aprobada y acepta respuestas equivalentes. Cada nota requiere tu confirmación.</p>
    <div className="jurado-estado"><span><strong>{pendientes}</strong> por calificar</span><span><strong>{consultas}</strong> en consulta</span><label><input type="checkbox" checked={atajos} onChange={e => setAtajos(e.target.checked)}/> Activar Ctrl + Enter para guardar (fuera de campos de texto)</label></div>
    {s?.error && <div className="alert alert-error" role="alert">{s.error}{s.conflicto && <><p>Conservamos tu borrador local. Recarga para revisar el estado actual antes de continuar.</p><button className="btn btn-secondary" disabled={s.ocupado} onClick={() => control.current.iniciar()}>Recargar respuestas</button></>}</div>}
    {!s?.resumen ? <div role="status"><p>{s?.commitPendiente ? 'Hay un envío sin confirmar. Reintenta para comprobar su resultado.' : 'Cargando la mesa de revisión…'}</p>{s?.error && <button className="btn btn-secondary" disabled={s.ocupado} onClick={() => control.current.iniciar()}>Reintentar conexión</button>}</div> : <>
      <div className="jurado-filtros card">
        <label className="form-label">Pregunta a revisar<select aria-label="Pregunta a revisar" className="form-input" value={s.grupo} disabled={bloqueado} onChange={e => control.current.cambiar(e.target.value, s.modo)}>{s.resumen.preguntas.map((g, i) => <option key={g.clave} value={g.clave}>{i + 1}. {g.tipo === 'contexto' ? 'Contexto' : 'Respuesta'} · {g.pendientes} pendientes · {g.texto.slice(0, 85)}</option>)}</select></label>
        <label className="form-label">Cola<select aria-label="Cola" className="form-input" value={s.modo} disabled={bloqueado} onChange={e => control.current.cambiar(s.grupo, e.target.value)}>{modos.map(([valor, texto]) => <option value={valor} key={valor}>{texto}</option>)}</select></label>
        <button className="btn btn-secondary" disabled={bloqueado} onClick={() => control.current.cambiar(s.grupo, s.modo)}><RefreshCw size={16}/>Actualizar</button>
      </div>
      {!s.resumen.preguntas.length ? <section className="card etapa-empty"><h2>No hay respuestas escritas en esta sesión</h2></section> : <div className="jurado-mesa">
        <aside className="card jurado-referencia"><p className="eyebrow">{grupo?.tipo === 'contexto' ? 'Contexto' : 'Respuesta abierta'} · {grupo?.maximo} puntos</p><h2>Pregunta</h2><p className="revision-texto">{grupo?.texto}</p><details open><summary>Referencia aprobada para el jurado</summary><p className="revision-texto">{grupo?.referencia}</p></details><p className="jurado-ayuda">El orden de la prueba puede variar. Aquí se agrupan las respuestas a la misma pregunta de esta sociedad.</p></aside>
        <section className="card jurado-respuesta" aria-busy={s.ocupado}>
          {!s.item ? <div className="etapa-empty"><h2>{s.ocupado ? 'Preparando respuesta…' : 'No hay respuestas disponibles en esta cola'}</h2><p>Las respuestas reservadas por otro jurado aparecerán cuando se liberen. Puedes cambiar de pregunta o actualizar.</p></div> : <>
            <div className="jurado-respuesta-heading"><h2 ref={respuestaHeading} tabIndex={-1}>Respuesta del participante</h2><span className="eyebrow">Revisión individual · {s.item.id.slice(-6)}</span></div>
            {!s.item.pendiente && <p className="etapa-aviso">Segunda revisión · Nota guardada: {s.item.puntaje_anterior} / {grupo.maximo}. Los cambios quedan auditados.</p>}
            {s.item.consulta && <p className="etapa-aviso">En consulta: {s.item.motivo_consulta || 'Requiere otra revisión del jurado.'}</p>}
            <div className="jurado-texto revision-texto">{s.item.texto || 'Sin texto de respuesta.'}</div>
            <fieldset className="jurado-criterios" disabled={bloqueado}><legend>Criterios de la rúbrica</legend>
              {criterios.map((c, i) => <div className="jurado-criterio" key={i}><p><strong>{i + 1}.</strong> {c.criterio}</p><div className="jurado-puntos" role="group" aria-label={'Criterio ' + (i + 1)}>{Array.from({ length: c.puntos + 1 }, (_, n) => <button type="button" key={n} aria-pressed={s.puntos[i] === n} onClick={() => { const puntos = [...s.puntos]; puntos[i] = n; control.current.editar({ puntos }) }}>{c.puntos === 1 ? (n ? 'Cumple · 1' : 'No cumple · 0') : n + ' pt'}</button>)}</div></div>)}
              <button type="button" className="btn btn-secondary" onClick={() => control.current.editar({ puntos: criterios.map(c => c.puntos) })}><CheckCheck size={16}/>Marcar todos como cumplidos</button>
              <label className="form-label">Observación del jurado<textarea className="form-input" rows={3} maxLength={1500} value={s.comentario} onChange={e => control.current.editar({ comentario: e.target.value })}/></label>
              <div className="jurado-plantillas">{['Respuesta parcial: falta desarrollar el criterio indicado.', 'Se acepta una expresión equivalente a la referencia.'].map(texto => <button type="button" key={texto} onClick={() => control.current.editar({ comentario: [s.comentario, texto].filter(Boolean).join(' ').slice(0, 1500) })}>{texto}</button>)}</div>
            </fieldset>
            <div className="jurado-guardar"><div><strong>{total} / {grupo.maximo}</strong><small>{s.puntos.filter(n => n !== null).length} de {criterios.length} criterios marcados</small></div><button className="btn btn-primary" disabled={s.ocupado || s.conflicto} onClick={() => control.current.guardar()}><Save size={18}/>{s.ocupado ? 'Procesando…' : s.commitPendiente ? 'Reintentar confirmación' : 'Guardar y siguiente'}</button></div>
            <p className="jurado-borrador" role="status">{s.borrador || 'Los criterios comienzan sin puntaje. No se guarda una nota hasta confirmar.'}</p>
            {s.item.pendiente && <details className="jurado-consulta"><summary><HelpCircle size={16}/>Dejar esta respuesta para consulta</summary><p>Conserva el borrador y la deja pendiente, sin asignarle cero.</p><label className="form-label">Motivo de consulta (opcional)<input className="form-input" maxLength={500} value={s.motivo} disabled={bloqueado} onChange={e => control.current.editar({ motivo: e.target.value })}/></label><button className="btn btn-secondary" disabled={bloqueado} onClick={() => control.current.consultar()}>Enviar a consulta y seguir</button></details>}
            <div className="jurado-ia"><div><h3>Autocalificación</h3><p>Presupuesto total de Efesios: US$5. La propuesta no guarda ninguna nota.</p></div><button className="btn btn-secondary" disabled={bloqueado || s.ia || !s.item.pendiente} onClick={() => control.current.sugerir()}><Brain size={17}/>{s.ia ? 'Preparando propuesta…' : 'Pedir propuesta'}</button>
              {s.sugerencia && <section className="jurado-propuesta"><p className="eyebrow">{s.sugerencia.modelo} · {s.sugerencia.cache ? 'Propuesta recuperada sin nueva generación' : 'Propuesta para revisión'}</p>{s.sugerencia.criterios.map(c => <div key={c.indice}><strong>Criterio {c.indice}: {c.puntos} puntos</strong><p>{c.evidencia && 'Evidencia: ' + c.evidencia}</p><p>{c.justificacion}</p></div>)}<p>{s.sugerencia.justificacion}</p><p>Disponible tras reservas: US${Number(s.sugerencia.disponible_usd).toFixed(2)}</p><button className="btn btn-secondary" disabled={bloqueado} onClick={() => control.current.aplicarSugerencia()}>Usar propuesta en el borrador</button></section>}
            </div>
          </>}
        </section>
      </div>}
    </>}
  </main></>
}
