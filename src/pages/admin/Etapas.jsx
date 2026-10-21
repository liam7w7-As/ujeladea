import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Archive, ArrowRight, BookOpen, CheckCircle2, Layers, Plus, Settings2, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { codigoEtapa, ESTADOS_ETAPA, etiquetaEtapa, mensajeErrorEtapas, validarEtapa } from '../../lib/etapas'
import { useEtapa } from '../../context/etapa-context'
import NavAdmin from '../../components/NavAdmin'
import DialogoEtapa from '../../components/DialogoEtapa'

function EditorEtapa({ etapa, siguienteNumero, anio, onClose, onSaved }) {
  const [form, setForm] = useState(() => etapa || { nombre: '', libro: '', anio, numero: siguienteNumero, tiempo_limite: 60, cantidad_preguntas: 45 })
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const nombreRef = useRef(null)
  useEffect(() => { nombreRef.current?.focus() }, [])
  function cambiar(e) { setForm(prev => ({ ...prev, [e.target.name]: e.target.value })) }
  async function guardar(e) {
    e.preventDefault()
    setGuardando(true)
    setError('')
    try {
      const payload = validarEtapa(form)
      const consulta = etapa
        ? supabase.from('etapas').update(payload).eq('id', etapa.id).eq('estado', 'borrador')
        : supabase.from('etapas').insert({ ...payload, codigo: codigoEtapa(payload), estado: 'borrador', reglas: { version: 2 } })
      const { error } = await consulta.select('id').single()
      if (error) throw error
      await onSaved()
      onClose()
    } catch (err) { setError(mensajeErrorEtapas(err)); setGuardando(false) }
  }
  return <section className="card etapa-editor" aria-labelledby="editor-etapa-titulo">
    <div className="etapa-heading"><div><p className="eyebrow">Configuración</p><h2 id="editor-etapa-titulo">{etapa ? 'Editar preparación' : 'Crear nueva etapa'}</h2></div><button className="btn btn-secondary icon-button" onClick={onClose} disabled={guardando} aria-label="Cerrar formulario"><X size={19} /></button></div>
    <p className="etapa-help">La etapa se guarda en preparación. El banco y las sesiones se mantienen separados de las demás etapas.</p>
    {error && <p className="alert alert-error" role="alert">{error}</p>}
    <form onSubmit={guardar}>
      <div className="etapa-form-grid">
        <label className="form-group"><span className="form-label">Nombre de la etapa</span><input ref={nombreRef} name="nombre" className="form-input" value={form.nombre} onChange={cambiar} required maxLength={80} placeholder="Segunda etapa" /></label>
        <label className="form-group"><span className="form-label">Libro de la Biblia</span><input name="libro" className="form-input" value={form.libro} onChange={cambiar} required maxLength={80} placeholder="Efesios" /></label>
        {[['anio', 'Año', 2000, 9999], ['numero', 'Número de etapa', 1, 100], ['tiempo_limite', 'Duración en minutos', 1, 240], ['cantidad_preguntas', 'Preguntas por joven', 1, 200]].map(([name, label, min, max]) =>
          <label className="form-group" key={name}><span className="form-label">{label}</span><input type="number" name={name} className="form-input" min={min} max={max} step="1" value={form[name]} onChange={cambiar} disabled={Boolean(etapa) && (name === 'anio' || name === 'numero')} required /></label>)}
      </div>
      <div className="etapa-actions"><button type="button" className="btn btn-secondary" onClick={onClose} disabled={guardando}>Cancelar</button><button className="btn btn-primary" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar preparación'}</button></div>
    </form>
  </section>
}

export default function Etapas() {
  const { etapas, etapa: seleccionada, cargando, error, seleccionar, recargar } = useEtapa()
  const navigate = useNavigate()
  const [editor, setEditor] = useState(null)
  const [confirmacion, setConfirmacion] = useState(null)
  const [procesando, setProcesando] = useState(false)
  const [aviso, setAviso] = useState('')
  const [errorAccion, setErrorAccion] = useState('')
  const [bancos, setBancos] = useState({})
  const anio = new Date().getFullYear()
  const siguienteNumero = Math.max(0, ...etapas.filter(e => e.anio === anio).map(e => e.numero)) + 1

  useEffect(() => {
    let vigente = true
    async function cargarBancos() {
      const entradas = await Promise.all(etapas.filter(e => e.estado !== 'cerrada').map(async e => {
        const { count, error } = await supabase.from('preguntas').select('id', { count: 'exact', head: true }).eq('etapa_id', e.id).eq('activa', true)
        return [e.id, error ? null : count]
      }))
      if (vigente) setBancos(Object.fromEntries(entradas))
    }
    void cargarBancos()
    return () => { vigente = false }
  }, [etapas])

  function abrir(etapa) {
    seleccionar(etapa.id)
    navigate('/admin/dashboard')
  }
  async function cambiarEstado() {
    if (!confirmacion || procesando) return
    setProcesando(true)
    setErrorAccion('')
    try {
      const nueva = confirmacion.estado === 'borrador' ? 'activa' : 'cerrada'
      const { error } = await supabase.from('etapas').update({ estado: nueva }).eq('id', confirmacion.id).eq('estado', confirmacion.estado).select('id').single()
      if (error) throw error
      setAviso(nueva === 'activa' ? 'Etapa activada. Ya puedes iniciar sus sesiones.' : 'Etapa cerrada. Su archivo histórico está protegido.')
      setConfirmacion(null)
      await recargar()
    } catch (err) { setErrorAccion(mensajeErrorEtapas(err)) }
    finally { setProcesando(false) }
  }
  return <><NavAdmin /><main className="admin-content">
    <div className="etapa-page-title"><div><p className="eyebrow">Olimpiadas Bíblicas · UJELADEA</p><h1>Una nueva etapa,<br /><span>el mismo propósito.</span></h1><p className="etapa-intro">Prepara el próximo examen y consulta el camino recorrido.</p></div><button className="btn btn-primary" onClick={() => { setEditor({ nueva: true }); setAviso('') }} disabled={cargando || Boolean(error)}><Plus size={18} />Crear nueva etapa</button></div>
    {error && <div className="alert alert-error" role="alert"><span>{error}</span><button className="btn btn-secondary" onClick={recargar}>Reintentar</button></div>}
    {aviso && <p className="alert alert-success" role="status"><CheckCircle2 size={18} />{aviso}</p>}
    {editor && <EditorEtapa key={editor.id || 'nueva'} etapa={editor.nueva ? null : editor} siguienteNumero={siguienteNumero} anio={anio} onClose={() => setEditor(null)} onSaved={async () => { await recargar(); setAviso('La preparación se guardó correctamente.') }} />}
    {cargando ? <p className="etapa-loading" role="status">Cargando etapas…</p> : <div className="etapas-grid">
      {etapas.map(etapa => {
        const cerrada = etapa.estado === 'cerrada'
        const activas = bancos[etapa.id]
        const faltan = typeof activas === 'number' ? Math.max(0, etapa.cantidad_preguntas - activas) : null
        return <article key={etapa.id} className={`card etapa-card ${cerrada ? 'etapa-card-closed' : ''}`}>
          <div className="etapa-card-top"><span className="etapa-card-icon">{cerrada ? <Archive size={25} /> : <BookOpen size={25} />}</span><span className={`etapa-status ${etapa.estado}`}>{ESTADOS_ETAPA[etapa.estado]}</span></div>
          <p className="eyebrow">Etapa {String(etapa.numero).padStart(2, '0')} · {etapa.anio}</p><h2>{etapa.libro}</h2><p className="etapa-card-name">{etapa.nombre}</p>
          <p className="etapa-card-description">{cerrada ? 'Resultados y preguntas conservados en su archivo histórico.' : 'Tu espacio para preparar preguntas, organizar sesiones y acompañar a los jóvenes.'}</p>
          <dl className="etapa-stats"><div><dt>Preguntas por joven</dt><dd>{etapa.cantidad_preguntas}</dd></div><div><dt>Duración</dt><dd>{etapa.tiempo_limite} <small>min</small></dd></div></dl>
          {!cerrada && <p className="etapa-bank-status">{activas == null ? 'No se pudo verificar el banco todavía.' : `${activas} ${activas === 1 ? 'pregunta activa' : 'preguntas activas'}${faltan ? ` · faltan ${faltan} para activar` : ' · banco suficiente'}`}</p>}
          <button className={`btn ${cerrada ? 'btn-secondary' : 'btn-primary'}`} onClick={() => abrir(etapa)}>{cerrada ? `Consultar ${etapa.libro}` : etapa.estado === 'borrador' ? `Preparar ${etapa.libro}` : `Administrar ${etapa.libro}`}<ArrowRight size={18} /></button>
          {!cerrada && <div className="etapa-card-tools">{etapa.estado === 'borrador' && <button onClick={() => setEditor(etapa)}><Settings2 size={15} />Configurar</button>}<button onClick={() => { setConfirmacion(etapa); setErrorAccion('') }} disabled={etapa.estado === 'borrador' && (faltan === null || faltan > 0)}>{etapa.estado === 'borrador' ? 'Activar etapa' : 'Cerrar etapa'}</button></div>}
          {seleccionada?.id === etapa.id && <span className="etapa-current">Seleccionada</span>}
        </article>
      })}
      {!error && etapas.length === 0 && <section className="card"><Layers size={32} /><h2>Aún no hay etapas</h2><p>Crea una etapa para empezar a organizar el torneo.</p></section>}
    </div>}
    <div className="etapa-footer"><Archive size={18} /><p>Cada etapa conserva su propio banco, sesiones y resultados. Las etapas cerradas se consultan en modo de solo lectura.</p></div>
    {confirmacion && <DialogoEtapa bloqueado={procesando} onClose={() => setConfirmacion(null)}>
        <p className="eyebrow">{etiquetaEtapa(confirmacion)}</p><h2 id="confirmar-etapa-titulo">{confirmacion.estado === 'borrador' ? '¿Activar esta etapa?' : '¿Cerrar esta etapa?'}</h2>
        <p>{confirmacion.estado === 'borrador' ? 'La duración y las reglas quedarán fijas. La base comprobará que tengas suficientes preguntas activas.' : 'El cierre genera un archivo histórico y bloquea cambios posteriores. Deben estar finalizadas todas las sesiones y resueltas las calificaciones pendientes. No podrás reabrirla.'}</p>
        {errorAccion && <p className="alert alert-error" role="alert">{errorAccion}</p>}
        <div className="etapa-actions"><button autoFocus className="btn btn-secondary" disabled={procesando} onClick={() => setConfirmacion(null)}>Cancelar</button><button className="btn btn-primary" disabled={procesando} onClick={cambiarEstado}>{procesando ? 'Procesando…' : confirmacion.estado === 'borrador' ? 'Sí, activar etapa' : 'Sí, cerrar etapa'}</button></div>
    </DialogoEtapa>}
    <Link className="etapa-catalog-link" to="/admin/sociedades">Administrar el catálogo de sociedades</Link>
  </main></>
}
