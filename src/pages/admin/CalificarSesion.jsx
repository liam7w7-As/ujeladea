import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Brain, Save } from 'lucide-react'
import { useEtapa } from '../../context/etapa-context'
import { cargarDatosSesion, respuestasParticipante } from '../../lib/etapas'
import { supabase } from '../../lib/supabase'
import { solicitarSugerencia } from '../../lib/ai'
import NavAdmin from '../../components/NavAdmin'
export default function CalificarSesion(){
 const {id}=useParams(),{etapa}=useEtapa()
 const [segunda,setSegunda]=useState(false)
 const [respuestas,setRespuestas]=useState(null),[error,setError]=useState(''),[valores,setValores]=useState({}),[comentarios,setComentarios]=useState({}),[ocupada,setOcupada]=useState(''),[sugerencias,setSugerencias]=useState({})
 useEffect(()=>{let vigente=true;cargarDatosSesion(supabase,etapa,id).then(d=>{if(vigente)setRespuestas(d.participantes.filter(p=>p.sesion_id===id).flatMap(p=>respuestasParticipante(d,p.id).filter(r=>r.preguntas.tipo!=='multiple'&&(segunda||r.calificado_por==='pendiente_ia'||r.puntaje_obtenido===null))))}).catch(e=>{if(vigente)setError(e.message)});return()=>{vigente=false}},[id,etapa,segunda])
 async function guardar(r){setOcupada(r.id);setError('');try{
  const rubrica=r.preguntas.rubrica||[]
  const v=valores[r.id]
  if(rubrica.length){if(!Array.isArray(v)||v.length!==rubrica.length||v.some((n,i)=>n===''||n===undefined||!Number.isInteger(Number(n))||Number(n)<0||Number(n)>rubrica[i].puntos))throw Error('Completa todos los criterios dentro de su máximo.')}
  else if(v===undefined||v===''||!Number.isInteger(Number(v)))throw Error('Indica una calificación válida.')
  const resultado=rubrica.length?await supabase.rpc('admin_examen_calificar_rubrica',{p_respuesta:r.id,p_puntos:v.map(Number),p_comentario:comentarios[r.id]||'',p_revision:r.revision_calificacion||0}):await supabase.rpc('admin_examen_calificar',{p_respuesta:r.id,p_puntaje:Number(v),p_metodo:'manual'})
  if(resultado.error)throw resultado.error
  setRespuestas(prev=>prev.filter(x=>x.id!==r.id))
 }catch(e){setError(e.message)}finally{setOcupada('')}}
 async function sugerir(r){setOcupada(r.id);try{const s=await solicitarSugerencia(supabase,r.id);setSugerencias(p=>({...p,[r.id]:s}))}catch(e){setError(e.message)}finally{setOcupada('')}}
 return <><NavAdmin/><main className="admin-content"><div className="etapa-heading"><div><p className="eyebrow">Revisión del jurado · {etapa.libro}</p><h1>Calificar respuestas</h1><p>{respuestas?.length??'—'} pendientes</p></div><Link className="btn btn-secondary" to={'/admin/sesion/'+id+'/resultados'}>Volver a resultados</Link></div><p className="etapa-help">La identidad se oculta durante la corrección. Aplica la rúbrica; los errores de escritura no descuentan puntos salvo criterio expresamente acordado. La IA solo sugiere.</p>
 <label className="form-label"><input type="checkbox" checked={segunda} onChange={e=>setSegunda(e.target.checked)}/> Incluir respuestas calificadas para segunda revisión (cada cambio queda auditado)</label>
 {error&&<p className="alert alert-error" role="alert">{error}</p>}
 {!respuestas?<p role="status">Cargando respuestas…</p>:!respuestas.length?<section className="card etapa-empty"><h2>No quedan respuestas pendientes</h2></section>:respuestas.slice(0,20).map(r=><article className="card revision-respuesta" key={r.id}><p className="eyebrow">Respuesta {r.id.slice(-6)} · Máximo {r.preguntas.puntaje} puntos</p><h2>{r.preguntas.texto}</h2><div className="revision-columnas"><section><h3>Respuesta del participante</h3><p className="revision-texto">{r.respuesta_dada}</p></section><section><h3>Referencia del jurado</h3><p className="revision-texto">{r.preguntas.respuesta_correcta}</p></section></div>
 {(r.preguntas.rubrica||[]).length?<fieldset className="rubrica-editor"><legend>Criterios de evaluación</legend>{r.preguntas.rubrica.map((c,i)=><label key={i}><span>{c.criterio} · máximo {c.puntos}</span><input aria-label={'Criterio '+(i+1)+' de '+r.id} className="form-input" type="number" min="0" max={c.puntos} step="1" value={valores[r.id]?.[i]??''} disabled={Boolean(ocupada)} onChange={e=>setValores(p=>{const v=[...(p[r.id]||Array(r.preguntas.rubrica.length).fill(''))];v[i]=e.target.value;return{...p,[r.id]:v}})}/></label>)}</fieldset>:<label className="form-label">Puntaje del jurado<input className="form-input" type="number" min="0" max={r.preguntas.puntaje} value={valores[r.id]??''} onChange={e=>setValores(p=>({...p,[r.id]:e.target.value}))}/></label>}
 <label className="form-label">Observación de la revisión<textarea className="form-input" maxLength={1500} value={comentarios[r.id]||''} onChange={e=>setComentarios(p=>({...p,[r.id]:e.target.value}))}/></label>
 <div className="etapa-actions"><button className="btn btn-primary" onClick={()=>guardar(r)} disabled={Boolean(ocupada)}><Save size={16}/>Guardar calificación</button><button className="btn btn-secondary" onClick={()=>sugerir(r)} disabled={Boolean(ocupada)}><Brain size={16}/>Pedir sugerencia de IA</button></div>
 {sugerencias[r.id]&&<div className="etapa-aviso">Sugerencia orientativa: {sugerencias[r.id].puntaje} puntos. {sugerencias[r.id].justificacion} Revisa y completa los criterios antes de guardar.</div>}
 </article>)}</main></>
}
