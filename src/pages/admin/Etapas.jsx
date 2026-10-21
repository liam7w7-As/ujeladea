import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, LockKeyhole, Settings2, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { codigoEtapa, ESTADOS_ETAPA, mensajeErrorEtapas, validarEtapa } from '../../lib/etapas'
import { useEtapa } from '../../context/etapa-context'
import NavAdmin from '../../components/NavAdmin'
import DialogoEtapa from '../../components/DialogoEtapa'
import { DISTRIBUCION } from '../../lib/modelo-efesios'

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
          <label className="form-group" key={name}><span className="form-label">{label}</span><input type="number" name={name} className="form-input" min={min} max={max} step="1" value={form[name]} onChange={cambiar} disabled={Boolean(etapa) && (name === 'anio' || name === 'numero' || name === 'cantidad_preguntas')} required /></label>)}
      </div>
      <div className="etapa-actions"><button type="button" className="btn btn-secondary" onClick={onClose} disabled={guardando}>Cancelar</button><button className="btn btn-primary" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar preparación'}</button></div>
    </form>
  </section>
}

export default function Etapas() {
 const { etapas, etapa, cargando, error, recargar } = useEtapa()
 const navigate=useNavigate()
 const [editor,setEditor]=useState(null),[confirmacion,setConfirmacion]=useState(null),[ocupado,setOcupado]=useState(false),[aviso,setAviso]=useState(''),[fallo,setFallo]=useState(''),[banco,setBanco]=useState({})
 useEffect(()=>{let vigente=true;if(!etapa)return;Promise.all(['multiple','abierta','contexto'].map(async tipo=>{const {count,error}=await supabase.from('preguntas').select('id',{count:'exact',head:true}).eq('etapa_id',etapa.id).eq('activa',true).eq('tipo',tipo);return[tipo,error?null:count]})).then(v=>{if(vigente)setBanco(Object.fromEntries(v))});return()=>{vigente=false}},[etapa])
 const distribucion={...DISTRIBUCION,...etapa?.reglas?.distribucion}
 const suficiente=Object.entries(distribucion).every(([t,n])=>banco[t]>=n)
 async function cambiar(){setOcupado(true);setFallo('');try{const estado=etapa.estado==='borrador'?'activa':'cerrada';const {error}=await supabase.from('etapas').update({estado}).eq('id',etapa.id).eq('estado',etapa.estado).select('id').single();if(error)throw error;setConfirmacion(null);await recargar();setAviso(estado==='activa'?'Efesios está listo para iniciar sesiones.':'La etapa se cerró y sus resultados se conservaron.')}catch(e){setFallo(mensajeErrorEtapas(e))}finally{setOcupado(false)}}
 return <><NavAdmin/><main className="admin-content inicio-efesios"><div className="etapa-heading"><div><p className="eyebrow">Olimpiadas Bíblicas · UJELADEA</p><h1>Segunda etapa · Efesios</h1><p className="etapa-help">Prepara la evaluación y acompaña a los jóvenes.</p></div></div>
 {error&&<p role="alert" className="alert alert-error">{error}<button onClick={recargar} className="btn btn-secondary">Reintentar</button></p>}
 {aviso&&<p role="status" className="alert alert-success">{aviso}</p>}
 {cargando?<p role="status">Cargando preparación…</p>:etapa&&<section className="card efesios-acceso"><div><span className={'etapa-status '+etapa.estado}>{ESTADOS_ETAPA[etapa.estado]}</span><h2>Efesios</h2><p>45 preguntas · {etapa.tiempo_limite} minutos · nota sobre 100</p></div><button className="btn btn-primary" onClick={()=>navigate('/admin/dashboard')}>Ingresar a Efesios<ArrowRight size={18}/></button></section>}
 {etapa&&<section className="preparacion-resumen" aria-label="Preparación del banco">{Object.entries(distribucion).map(([tipo,n])=><div key={tipo}><strong>{banco[tipo]??'—'} / {n}</strong><span>{tipo==='multiple'?'Opción múltiple':tipo==='abierta'?'Respuesta abierta':'Contexto bíblico'}</span><small>{etapa.reglas?.puntos?.[tipo]??'—'} puntos por pregunta</small></div>)}</section>}
 {etapa?.estado==='borrador'&&<div className="etapa-actions"><button className="btn btn-secondary" onClick={()=>setEditor(etapa)}><Settings2 size={16}/>Configurar duración</button><button className="btn btn-secondary" disabled={!suficiente} onClick={()=>setConfirmacion(true)}>Activar evaluación</button><p className="etapa-help">{suficiente?'El servidor comprobará también los puntajes y las rúbricas.':'Completa el banco revisado de cada tipo antes de activar.'}</p></div>}
 {etapa?.estado==='activa'&&<details className="acciones-etapa"><summary>Administrar cierre de la etapa</summary><button className="btn btn-secondary" onClick={()=>setConfirmacion(true)}>Cerrar etapa</button></details>}
 {editor&&<EditorEtapa etapa={editor} onClose={()=>setEditor(null)} onSaved={async()=>{setEditor(null);await recargar()}}/>}
 <section className="historial-bloqueado" aria-label="Etapas archivadas">{etapas.filter(e=>e.historica).map(e=><div key={e.id}><LockKeyhole size={18}/><span>{e.libro} · {e.anio}</span><small>Archivado · acceso bloqueado</small></div>)}</section>
 {confirmacion&&<DialogoEtapa bloqueado={ocupado} onClose={()=>setConfirmacion(null)}><h2 id="confirmar-etapa-titulo">{etapa.estado==='borrador'?'Activar Efesios':'Cerrar Efesios'}</h2><p>La configuración y el banco quedan fijos al activar. El cierre conserva el archivo y requiere todas las notas resueltas.</p>{fallo&&<p role="alert" className="alert alert-error">{fallo}</p>}<div className="etapa-actions"><button className="btn btn-secondary" onClick={()=>setConfirmacion(null)} disabled={ocupado}>Cancelar</button><button className="btn btn-primary" onClick={cambiar} disabled={ocupado}>{ocupado?'Procesando…':'Confirmar'}</button></div></DialogoEtapa>}
 <Link className="etapa-catalog-link" to="/admin/sociedades">Administrar sociedades</Link>
 </main></>
}
