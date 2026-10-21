import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Database, Download, Edit2, Plus, Search } from 'lucide-react'
import { useEtapa } from '../../context/etapa-context'
import { etiquetaEtapa, leerTodas } from '../../lib/etapas'
import { supabase } from '../../lib/supabase'
import NavAdmin from '../../components/NavAdmin'
import EtapaAviso from '../../components/EtapaAviso'

export default function BancoPreguntas() {
  const { etapa, archivo, soloLectura } = useEtapa()
  const [preguntas, setPreguntas] = useState(null)
  const [error, setError] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [tipo, setTipo] = useState('todas')
  const [filtroEstado, setFiltroEstado] = useState('todas')
  const [ocupada, setOcupada] = useState('')
  useEffect(() => {
    let vigente = true
    const promesa = soloLectura ? Promise.resolve(archivo.preguntas) : leerTodas(() => supabase.from('preguntas').select('*').eq('etapa_id', etapa.id))
    promesa.then(data => { if (vigente) setPreguntas(data) }).catch(err => { if (vigente) setError(err.message) })
    return () => { vigente = false }
  }, [etapa, archivo, soloLectura])
  const filtradas = (preguntas || []).filter(p => p.texto.toLowerCase().includes(busqueda.toLowerCase()) && (tipo === 'todas' || p.tipo === tipo) && (filtroEstado === 'todas' || Boolean(p.activa) === (filtroEstado === 'activas')))
  async function cambiarActiva(pregunta) {
    if (soloLectura || ocupada) return
    setOcupada(pregunta.id)
    setError('')
    try {
      const { error } = await supabase.from('preguntas').update({ activa: !pregunta.activa }).eq('id', pregunta.id).eq('etapa_id', etapa.id).select('id').single()
      if (error) throw error
      setPreguntas(prev => prev.map(p => p.id === pregunta.id ? { ...p, activa: !p.activa } : p))
    } catch (err) { setError(err.message) }
    finally { setOcupada('') }
  }
  async function exportar() {
    try {
      const { generarReportePDF } = await import('../../lib/pdf')
      await generarReportePDF({
        etapa, titulo: 'Banco de preguntas', subtitulo: etiquetaEtapa(etapa),
        columnas: ['Pregunta', 'Tipo', 'Estado', 'Puntaje', 'Respuesta de referencia'],
        filas: filtradas.map(p => [p.texto, p.tipo, p.activa ? 'Activa' : 'Inactiva', String(p.puntaje), p.respuesta_correcta || '']),
        nombreArchivo: `Banco_${etapa.codigo}.pdf`,
      })
    } catch (err) { setError('No se pudo exportar: ' + err.message) }
  }
  return <><NavAdmin /><main className="admin-content">
    <EtapaAviso />
    <div className="etapa-heading"><div><p className="eyebrow">{etapa.libro}</p><h1>Banco de preguntas</h1><p className="etapa-help">{preguntas?.filter(p => p.activa).length || 0} activas · {preguntas?.length || 0} en total</p></div><div className="etapa-actions"><button className="btn btn-secondary" onClick={exportar} disabled={!filtradas.length}><Download size={17} />Exportar PDF</button>{!soloLectura && <Link className="btn btn-primary" to="/admin/preguntas/nueva"><Plus size={17} />Nueva pregunta</Link>}</div></div>
    {!soloLectura && <section className="card banco-preparacion" aria-label="Preparación del banco pastoral">
      <h2>Base para las preguntas de {etapa.libro}</h2>
      <p>Incorpora aquí las preguntas revisadas por los pastores. Cada una necesita un enunciado claro, su respuesta de referencia y un puntaje.</p>
      <dl>
        <div><dt>Opción múltiple</dt><dd>Al menos dos opciones distintas y una respuesta correcta. Se corrige automáticamente con la referencia guardada.</dd></div>
        <div><dt>Respuesta abierta</dt><dd>Respuesta esperada, pasaje de apoyo y criterios para otorgar puntos parciales. El jurado asigna la nota.</dd></div>
        <div><dt>Contexto bíblico</dt><dd>Pasaje o situación que se analizará y una referencia que explique los elementos esperados. El jurado revisa la respuesta.</dd></div>
      </dl>
      <p className="etapa-help">Acuerden la versión bíblica y la distribución de puntos antes de activar la etapa. Solo las preguntas activas se asignan al iniciar un intento.</p>
    </section>}
    {error && <p className="alert alert-error" role="alert">{error}</p>}
    <div className="etapa-filters">
      <label><span className="form-label"><Search size={15} />Buscar pregunta</span><input className="form-input" value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Escribe una palabra…" /></label>
      <label><span className="form-label">Tipo</span><select className="form-input" value={tipo} onChange={e => setTipo(e.target.value)}><option value="todas">Todos</option><option value="multiple">Opción múltiple</option><option value="abierta">Respuesta abierta</option><option value="contexto">Contexto bíblico</option></select></label>
      <label><span className="form-label">Estado</span><select className="form-input" value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}><option value="todas">Todos</option><option value="activas">Activas</option><option value="inactivas">Inactivas</option></select></label>
    </div>
    {!preguntas && !error ? <p role="status">Cargando preguntas…</p> : filtradas.length === 0 ? <section className="card etapa-empty"><Database size={40} /><h2>{preguntas?.length ? 'Sin coincidencias' : `Prepara el banco de ${etapa.libro}`}</h2><p>{preguntas?.length ? 'Prueba con otros filtros.' : 'Añade las preguntas revisadas para esta etapa. Las de Hebreos se conservan en su historial.'}</p></section> :
      <div className="etapa-session-list">{filtradas.map(p => <article className="card etapa-question" key={p.id}>
        <div className="etapa-heading"><p className="eyebrow">{p.tipo} · {p.puntaje} pts · {p.activa ? 'Activa' : 'Inactiva'}</p>{!soloLectura && <div className="etapa-actions"><button className="btn btn-secondary" disabled={Boolean(ocupada)} onClick={() => cambiarActiva(p)}>{p.activa ? 'Desactivar' : 'Activar'}</button><Link className="btn btn-secondary" to={`/admin/preguntas/${p.id}/editar`}><Edit2 size={15} />Editar</Link></div>}</div>
        <h2>{p.texto}</h2><details><summary>Ver opciones y respuesta de referencia</summary>{p.opciones && <ul>{(typeof p.opciones === 'string' ? JSON.parse(p.opciones) : p.opciones).map((o, i) => <li key={i}>{typeof o === 'string' ? o : o.texto}</li>)}</ul>}<p>{p.respuesta_correcta || 'Sin referencia'}</p></details>
      </article>)}</div>}
  </main></>
}
