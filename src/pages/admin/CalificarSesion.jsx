import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Brain, Check, Save } from 'lucide-react'
import { useEtapa } from '../../context/etapa-context'
import { cargarDatosSesion, respuestasParticipante } from '../../lib/etapas'
import { supabase } from '../../lib/supabase'
import { solicitarSugerencia } from '../../lib/ai'
import NavAdmin from '../../components/NavAdmin'
import EtapaAviso from '../../components/EtapaAviso'

export default function CalificarSesion() {
  const { id } = useParams()
  const { etapa } = useEtapa()
  const [estado, setEstado] = useState({ respuestas: [], cargando: true, error: '' })
  const [sugerencias, setSugerencias] = useState({})
  const [puntajes, setPuntajes] = useState({})
  const [ocupada, setOcupada] = useState('')
  useEffect(() => {
    let vigente = true
    cargarDatosSesion(supabase, etapa, id).then(datos => {
      const participantes = datos.participantes.filter(p => p.sesion_id === id)
      const respuestas = participantes.flatMap(p => respuestasParticipante(datos, p.id)
        .filter(r => r.calificado_por === 'pendiente_ia' || r.puntaje_obtenido === null)
        .map(r => ({ ...r, nombre: p.nombre })))
      if (vigente) setEstado({ respuestas, cargando: false, error: '' })
    }).catch(err => { if (vigente) setEstado({ respuestas: [], cargando: false, error: err.message }) })
    return () => { vigente = false }
  }, [id, etapa])
  async function sugerir(respuesta) {
    setOcupada(respuesta.id)
    try {
      const sugerencia = await solicitarSugerencia(supabase, respuesta.id)
      setSugerencias(prev => ({ ...prev, [respuesta.id]: sugerencia }))
    } catch (err) { setEstado(prev => ({ ...prev, error: err.message })) }
    finally { setOcupada('') }
  }
  async function guardar(respuesta, usarIA = false) {
    const puntaje = usarIA ? sugerencias[respuesta.id]?.puntaje : Number(puntajes[respuesta.id])
    if ((!usarIA && (puntajes[respuesta.id] === undefined || puntajes[respuesta.id] === '')) || !Number.isInteger(puntaje) || puntaje < 0 || puntaje > respuesta.preguntas.puntaje) {
      setEstado(prev => ({ ...prev, error: 'Indica un puntaje entero dentro del valor de la pregunta.' }))
      return
    }
    setOcupada(respuesta.id)
    try {
      const { error } = await supabase.rpc('admin_examen_calificar', { p_respuesta: respuesta.id, p_puntaje: puntaje, p_metodo: usarIA ? 'ia' : 'manual' })
      if (error) throw error
      setEstado(prev => ({ ...prev, error: '', respuestas: prev.respuestas.filter(r => r.id !== respuesta.id) }))
    } catch (err) { setEstado(prev => ({ ...prev, error: err.message })) }
    finally { setOcupada('') }
  }
  return <><NavAdmin /><main className="admin-content"><EtapaAviso /><div className="etapa-heading"><div><p className="eyebrow">Revisión del jurado</p><h1>Calificar respuestas</h1><p>{estado.respuestas.length} pendientes</p></div><Link className="btn btn-secondary" to={'/admin/sesion/' + id + '/resultados'}>Volver a resultados</Link></div>
    {estado.error && <p className="alert alert-error" role="alert">{estado.error}</p>}
    {estado.cargando ? <p role="status">Cargando respuestas…</p> : !estado.respuestas.length ? <section className="card etapa-empty"><Check size={36} /><h2>No quedan respuestas pendientes</h2></section> :
      <div className="etapa-session-list">{estado.respuestas.map(r => <article className="card revision-respuesta" key={r.id}>
        <p className="eyebrow">{r.nombre} · Máximo {r.preguntas.puntaje} puntos</p><h2>{r.preguntas.texto}</h2><p className="revision-texto">{r.respuesta_dada}</p><details><summary>Ver referencia de la pregunta asignada</summary><p className="revision-texto">{r.preguntas.respuesta_correcta}</p></details>
        <div className="revision-calificar"><label className="form-group"><span className="form-label">Puntaje del jurado</span><input className="form-input" type="number" min="0" max={r.preguntas.puntaje} step="1" value={puntajes[r.id] ?? ''} onChange={e => setPuntajes(prev => ({ ...prev, [r.id]: e.target.value }))} disabled={Boolean(ocupada)} /></label><button className="btn btn-primary" onClick={() => guardar(r)} disabled={Boolean(ocupada)}><Save size={16} />Guardar calificación</button><button className="btn btn-secondary" onClick={() => sugerir(r)} disabled={Boolean(ocupada)}><Brain size={16} />{ocupada === r.id ? 'Procesando…' : 'Pedir sugerencia de IA'}</button></div>
        {sugerencias[r.id] && <div className="etapa-aviso"><div><strong>Sugerencia: {sugerencias[r.id].puntaje} puntos</strong><p>{sugerencias[r.id].justificacion}</p><button className="btn btn-secondary" disabled={Boolean(ocupada)} onClick={() => guardar(r, true)}>Aceptar sugerencia revisada</button></div></div>}
      </article>)}</div>}
  </main></>
}
