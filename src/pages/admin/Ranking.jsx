import { useEffect, useState } from 'react'
import { Download, Trophy } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { cargarResumenEtapa, rankingEtapa } from '../../lib/etapas'
import { formatoNota } from '../../lib/modelo-efesios'
import { useEtapa } from '../../context/etapa-context'
import NavAdmin from '../../components/NavAdmin'
export default function Ranking(){
 const {etapa,archivo}=useEtapa()
 const [datos,setDatos]=useState(null),[error,setError]=useState(''),[exportando,setExportando]=useState(false)
 useEffect(()=>{let vigente=true;cargarResumenEtapa(supabase,etapa,archivo).then(v=>{if(vigente)setDatos(v)}).catch(e=>{if(vigente)setError(e.message)});return()=>{vigente=false}},[etapa,archivo])
 const ranking=datos?rankingEtapa(datos):null
 const provisional=etapa.estado!=='cerrada'||ranking?.provisional
 async function exportar(){setExportando(true);try{const {generarInformeEtapaV2}=await import('../../lib/pdf-etapa');await generarInformeEtapaV2({datos,etapa,nombreArchivo:'Informe_'+etapa.codigo+'.pdf'})}catch(e){setError(e.message)}finally{setExportando(false)}}
 return <><NavAdmin/><main className="admin-content"><div className="etapa-heading"><div><p className="eyebrow">{etapa.libro} · evaluación individual</p><h1>Resultados y ranking</h1><p className="etapa-help">Notas sobre 100. Sociedades por promedio de sus participantes.</p></div><button className="btn btn-secondary" disabled={!datos||exportando} onClick={exportar}><Download size={17}/>{exportando?'Preparando…':'Informe para el jurado'}</button></div>
 {error&&<p className="alert alert-error" role="alert">{error}</p>}
 {provisional&&<div className="etapa-aviso">Resultados provisionales: completa la revisión del jurado y cierra la etapa antes de declarar ganadores.</div>}
 {!ranking?<p role="status">Cargando resultados…</p>:<><section className="card tabla-resultados"><h2><Trophy size={22}/> Rendimiento de sociedades</h2><p className="etapa-help">Una fila por sociedad, consolidando sus sesiones. Las alertas no descuentan puntos. Los empates comparten posición.</p><div className="tabla-scroll"><table><thead><tr><th>Posición</th><th>Sociedad</th><th>Evaluados</th><th>Promedio / 100</th><th>Con 80 o más</th><th>Pendientes</th></tr></thead><tbody>{ranking.rankingSociedades.map(s=><tr key={s.sociedadId||s.sesionId}><td>{s.posicion??'—'}</td><td>{s.sociedad}<small>{s.iglesia}</small></td><td>{s.rindieron}</td><td><strong>{formatoNota(s.porcentaje)}</strong></td><td>{s.destacados??'—'}</td><td>{s.pendientesIA}</td></tr>)}</tbody></table></div>{!ranking.rankingSociedades.length&&<p className="etapa-empty">Todavía no hay evaluaciones finalizadas.</p>}</section>
 <section className="card tabla-resultados"><h2>Ranking individual</h2><p className="etapa-help">Se compara la nota sin redondearla. La duración y las alertas no se usan como desempate.</p><div className="tabla-scroll"><table><thead><tr><th>Posición</th><th>Participante</th><th>Sociedad</th><th>Nota / 100</th><th>Pendientes</th></tr></thead><tbody>{(ranking.todosJovenes||ranking.topJovenes).map(j=><tr key={j.id}><td>{j.posicion??'—'}</td><td>{j.nombre}</td><td>{j.sociedad}</td><td><strong>{formatoNota(j.efectividad)}</strong></td><td>{j.pendientes??0}</td></tr>)}</tbody></table></div></section></>}
 </main></>
}
