import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { cargarResumenEtapa } from '../../lib/etapas'
import { calcularPremiacion } from '../../lib/premiacion'
import { formatoNota } from '../../lib/modelo-efesios'
import { useEtapa } from '../../context/etapa-context'
import NavAdmin from '../../components/NavAdmin'
import Modal from '../../components/Modal'

export default function Premiacion() {
  const { etapa, archivo } = useEtapa()
  const [estado,setEstado]=useState(null),[error,setError]=useState(''),[ocupado,setOcupado]=useState(false)
  const [pdf,setPdf]=useState(null),[nota,setNota]=useState(''),[comparado,setComparado]=useState(false),[confirmar,setConfirmar]=useState(false)
  const [persona,setPersona]=useState(null),[destino,setDestino]=useState(''),[motivo,setMotivo]=useState('')
  const cargar=useCallback(async()=>{
    const [{data,error},datos]=await Promise.all([
      supabase.rpc('admin_premiacion_resumen'),cargarResumenEtapa(supabase,etapa,archivo),
    ])
    if(error)throw error
    return{resumen:data,datos}
  },[etapa,archivo])
  useEffect(()=>{let vigente=true;cargar().then(v=>{if(vigente)setEstado(v)}).catch(e=>{if(vigente)setError(e.message)});return()=>{vigente=false}},[cargar])
  const calculo=estado?calcularPremiacion(estado.resumen,estado.datos,etapa):null
  const historico=estado?.resumen.hebreos
  async function ejecutar(fn) {
    setOcupado(true);setError('')
    try { await fn();setEstado(await cargar()) } catch(e) { setError(e.message) } finally { setOcupado(false) }
  }
  async function seleccionarPdf(e) {
    const file=e.target.files?.[0];setPdf(null);setComparado(false)
    if(!file)return
    if(file.size>20*1024*1024){setError('El PDF debe pesar menos de 20 MB.');return}
    const bytes=await file.arrayBuffer()
    if(new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-'){setError('Selecciona el PDF original de resultados.');return}
    const hash=await crypto.subtle.digest('SHA-256',bytes)
    setPdf({nombre:file.name,sha256:[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('')})
    setError('')
  }
  async function validarPdf() {
    if(!pdf||!comparado||nota.trim().length<10)return
    await ejecutar(async()=>{
      const {error}=await supabase.rpc('admin_premiacion_validar_pdf',{p_sha256:pdf.sha256,p_nota:nota.trim(),p_confirmar:true})
      if(error)throw error
      setConfirmar(false)
    })
  }
  async function vincular() {
    if(!destino||motivo.trim().length<10||ocupado)return
    await ejecutar(async()=>{
      const {error}=await supabase.rpc('admin_premiacion_vincular',{
        p_efesios:persona.id,p_hebreos:destino==='solo'?null:destino,p_motivo:motivo.trim(),p_revision:persona.vinculo?.revision || 0,
      })
      if(error)throw error
      setPersona(null)
    })
  }
  const notaVisible=n=>n===null?'—':formatoNota(n)
  function tabla(filas,individual=false) {
    return <div className="tabla-scroll"><table className="etapa-results-table"><thead><tr><th>Posición</th><th>{individual?'Participante':'Sociedad'}</th><th>Hebreos / 100</th><th>Efesios / 100</th><th>General / 100</th><th>Estado</th>{individual&&<th>Identidad</th>}</tr></thead><tbody>{filas.map(f=><tr key={f.id}><td>{f.posicion??'—'}</td><th scope="row">{f.nombre}</th><td>{notaVisible(f.hebreos)}</td><td>{notaVisible(f.efesios)}</td><td><strong>{notaVisible(f.total)}</strong></td><td>{f.motivo||'Ambas etapas'}</td>{individual&&<td><button className="btn btn-secondary" onClick={()=>{setPersona(f);setDestino(f.vinculo?f.vinculo.hebreos||'solo':'');setMotivo('')}}>{f.vinculo?'Revisar identidad':'Verificar identidad'}</button></td>}</tr>)}</tbody></table>{!filas.length&&<p>Todavía no hay resultados para este acumulado.</p>}</div>
  }
  return <><NavAdmin/><main className="admin-content">
    <div className="etapa-heading"><div><p className="eyebrow">Hebreos + Efesios</p><h1>Premiación general</h1><p className="etapa-help">50 % de cada etapa. Hebreos conserva sus reglas V1 y Efesios sus reglas nuevas.</p></div></div>
    {error&&<p className="alert alert-error" role="alert">{error}</p>}
    {!calculo?<p role="status">Cargando resultados preservados…</p>:<>
      <section className="etapa-aviso premiacion-avisos"><strong>{calculo.provisional?'Acumulado provisional':'Acumulado con etapas cerradas y PDF contrastado'}</strong><ul>{calculo.avisos.map(a=><li key={a}>{a}</li>)}</ul><p>Las notas ausentes no se convierten en cero. Los empates comparten posición. Las identidades se verifican manualmente.</p></section>
      <section className="card tabla-resultados"><h2>Acumulado de sociedades</h2><p className="etapa-help">Resultado V1 preservado de Hebreos y promedio individual de Efesios. Cada etapa aporta la mitad.</p>{tabla(calculo.sociedades)}</section>
      <section className="card tabla-resultados"><h2>Acumulado individual</h2><p className="etapa-help">Solo se acumulan las notas de la misma persona con ambas etapas. Quien solo rindió Efesios conserva su resultado de esa etapa.</p>{tabla(calculo.individuales,true)}</section>
      <section className="card tabla-resultados"><h2>Resultados preservados de Hebreos</h2><p className="etapa-help">Resumen tomado del archivo original. Se conservan puntos, máximo, descuentos y promedio V1; no se modifica el examen ni se habilita el acceso a sus preguntas.</p>
        <div className="tabla-scroll"><table className="etapa-results-table"><thead><tr><th>Sociedad</th><th>Puntos / máximo V1</th><th>Porcentaje bruto</th><th>Descuento V1</th><th>Resultado V1 / 100</th></tr></thead><tbody>{historico.sociedades.map(h=><tr key={h.sesionId}><th scope="row">{h.sociedad}</th><td>{h.puntajeObtenido} / {h.puntajeMaximo}</td><td>{h.porcentajeBruto}</td><td>{h.penalizacionPorcentaje}</td><td>{h.nota}</td></tr>)}</tbody></table></div>
        <details><summary>Consultar las notas individuales preservadas</summary><div className="tabla-scroll"><table className="etapa-results-table"><thead><tr><th>Participante</th><th>Sociedad</th><th>Puntaje guardado</th><th>Máximo V1</th><th>Efectividad V1 / 100</th></tr></thead><tbody>{historico.participantes.map(h=><tr key={h.id}><th scope="row">{h.nombre}</th><td>{h.sociedad}</td><td>{h.puntaje}</td><td>{h.puntajeMax}</td><td>{h.nota}</td></tr>)}</tbody></table></div></details>
      </section>
      <section className="card tabla-resultados"><h2>Contrastar con el PDF de resultados de la primera etapa</h2>
        {estado.resumen.validacion_pdf?<><p>Comparación manual registrada el {new Date(estado.resumen.validacion_pdf.fecha).toLocaleString('es-BO')}.</p><p>{estado.resumen.validacion_pdf.nota}</p><p className="etapa-help">Huella SHA-256 del PDF revisado: <code className="hash-documento">{estado.resumen.validacion_pdf.sha256}</code></p></>:
        <form onSubmit={e=>{e.preventDefault();if(pdf&&comparado&&nota.trim().length>=10)setConfirmar(true)}}>
          <p>Comprueba la tabla anterior contra tu PDF original de resultados de Hebreos antes de confirmar. El sistema registra tu revisión; no interpreta ni compara automáticamente el contenido del PDF.</p>
          <label className="form-group"><span className="form-label">PDF original de resultados de Hebreos</span><input type="file" accept="application/pdf,.pdf" onChange={seleccionarPdf} required/></label>
          {pdf&&<p className="etapa-help">{pdf.nombre}. El archivo permanece en tu equipo; solo se registra su huella.</p>}
          <label className="form-group"><span className="form-label">Observación de la comprobación</span><textarea className="form-input" value={nota} onChange={e=>setNota(e.target.value)} minLength={10} maxLength={500} required/></label>
          <label className="confirmacion-pdf"><input type="checkbox" checked={comparado} onChange={e=>setComparado(e.target.checked)} required/> Revisé el PDF original y los resultados coinciden con los valores preservados.</label>
          <button className="btn btn-primary" disabled={ocupado||!pdf||!comparado||nota.trim().length<10}>Registrar comprobación</button>
        </form>}
      </section>
    </>}
    <Modal isOpen={confirmar} onClose={()=>setConfirmar(false)} onConfirm={()=>{if(!ocupado)void validarPdf()}} isConfirm titulo="Confirmar la comparación con el PDF original" mensaje="Se registrará tu declaración de coincidencia y la huella del archivo. Esta confirmación queda conservada y no modifica ninguna nota." textoConfirmar={ocupado?'Guardando…':'Confirmar comparación'}/>
    <Modal isOpen={Boolean(persona)} onClose={()=>setPersona(null)} onConfirm={vincular} isConfirm titulo={'Verificar identidad · '+(persona?.nombre||'')} mensaje="Comprueba que se trata de la misma persona. No se vincula automáticamente por coincidencia de nombre.">
      <label className="form-group"><span className="form-label">Participante de Hebreos</span><select aria-label="Participante de Hebreos" className="form-input" value={destino} onChange={e=>setDestino(e.target.value)}><option value="">Selecciona tras verificar</option><option value="solo">Participó solo en Efesios</option>{historico?.participantes.map(h=><option key={h.id} value={h.id}>{h.nombre} · {h.sociedad}</option>)}</select></label>
      <label className="form-group"><span className="form-label">Cómo verificaste la identidad</span><textarea className="form-input" value={motivo} onChange={e=>setMotivo(e.target.value)} maxLength={500} minLength={10}/></label>
      {error&&<p role="alert" className="alert alert-error">{error}</p>}
    </Modal>
  </main></>
}
