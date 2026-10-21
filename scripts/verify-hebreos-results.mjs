import fs from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {parseArgs} from 'node:util'
import {createTestDatabase,applyMigrations,loadVerifiedBackup,restoreBackup,assertOriginalData} from './lib/local-database.mjs'

const{values}=parseArgs({options:{'backup-dir':{type:'string'},report:{type:'string'}}})
if(!values['backup-dir'])throw Error('Indica --backup-dir con el respaldo privado de Hebreos')
const backup=await loadVerifiedBackup(values['backup-dir']),datos=backup.snapshot.data
const original=execFileSync('git',['show',backup.manifest.git_commit+':src/lib/supabase.js'],{encoding:'utf8'})
const start=original.indexOf('export async function calcularPuntajeSociedad(')
const funciones=original.slice(start).replaceAll('export async function','async function')
function from(tabla){
 let filtros=[],orden=null,limite=1000,unico=false,head=false,count=false
 function base(){
  if(tabla==='resumen_alertas')return datos.participantes.map(p=>({participante_id:p.id,total_eventos:datos.eventos_sesion.filter(e=>e.participante_id===p.id).length}))
  return datos[tabla].map(r=>{
   if(tabla==='sesiones')return{...r,sociedades:datos.sociedades.find(s=>s.id===r.sociedad_id)}
   if(tabla==='participantes'){const s=datos.sesiones.find(s=>s.id===r.sesion_id);return{...r,sesiones:s?{...s,sociedades:datos.sociedades.find(x=>x.id===s.sociedad_id)}:null}}
   if(tabla==='respuestas')return{...r,preguntas:datos.preguntas.find(q=>q.id===r.pregunta_id)}
   return r
  })
 }
 const b={
  select(_campos,opts={}){head=!!opts.head;count=!!opts.count;return b},
  eq(k,v){filtros.push(r=>r[k]===v);return b},
  in(k,vs){filtros.push(r=>vs.includes(r[k]));return b},
  order(k,{ascending=true}={}){orden={k,ascending};return b},
  limit(n){limite=Math.min(n,1000);return b},
  single(){unico=true;return b},
  then(resolve,reject){try{let filas=base().filter(r=>filtros.every(f=>f(r)));const total=filas.length
   if(orden)filas.sort((a,b)=>{const x=a[orden.k],y=b[orden.k];return(x===y?0:x<y?-1:1)*(orden.ascending?1:-1)})
   filas=filas.slice(0,limite)
   return Promise.resolve({data:head?null:unico?filas[0]:filas,error:null,...(count?{count:total}:{})}).then(resolve,reject)
  }catch(e){return Promise.reject(e).then(resolve,reject)}}
 }
 return b
}
// Ejecuta la función versionada que alimentaba el PDF, con un adaptador de lectura del respaldo.
const legacy=new Function('supabase',funciones+'\nreturn {calcularPuntajeSociedad,obtenerDatosCompletosRanking}')(Object.freeze({from}))
const anterior=await legacy.obtenerDatosCompletosRanking()
const db=await createTestDatabase()
try{
 await restoreBackup(db,backup);const migraciones=await applyMigrations(db,{existingV1:true})
 await assertOriginalData(db,backup.snapshot)
 const frozen=(await db.query('SELECT contenido,md5(contenido::text) huella FROM app_private.resultados_hebreos')).rows[0]
 for(const s of anterior.rankingSociedades){
  const f=frozen.contenido.sociedades.find(x=>x.sesionId===s.sesionId)
  for(const k of ['puntajeObtenido','puntajeMaximo','porcentajeBruto','penalizacionPorcentaje','promedioPorParticipante','totalAlertas','rindieron'])
   if(f?.[k]!==s[k])throw Error('Difiere un campo del cálculo V1: '+k)
  if(f.nota!==s.porcentaje)throw Error('Difiere la efectividad V1')
 }
 for(const p of datos.participantes){
  const f=frozen.contenido.participantes.find(x=>x.id===p.id)
  const maximo=datos.respuestas.filter(r=>r.participante_id===p.id).reduce((a,r)=>a+(datos.preguntas.find(q=>q.id===r.pregunta_id)?.puntaje||0),0)
  if(f.puntaje!==(p.puntaje_total||0)||f.puntajeMax!==maximo||f.nota!==(maximo?Math.min(100,Math.round((p.puntaje_total||0)/maximo*100)):0))
   throw Error('Difiere un resultado individual conservado')
 }
 for(const p of anterior.topJovenes){
  const f=frozen.contenido.participantes.find(x=>x.id===p.id)
  if(f.puntaje!==p.puntaje||f.puntajeMax!==p.puntajeMax||f.nota!==p.efectividad)throw Error('Difiere una nota del cuadro de honor V1')
 }
 const report={fecha:new Date().toISOString(),codigo_v1:backup.manifest.git_commit,
  sociedades:anterior.rankingSociedades.length,participantes:datos.participantes.length,
  respuestas:datos.respuestas.length,calculo_original_del_pdf_coincide:true,
  datos_originales_intactos:true,huella_resumen_hebreos:frozen.huella,
  huella_datos:(await db.query('SELECT md5($1::jsonb::text) h',[JSON.stringify(datos)])).rows[0].h,
  migraciones,archivo_pdf_del_usuario_contrastado:false}
 if(values.report)await fs.writeFile(values.report,JSON.stringify(report,null,2))
 console.log(JSON.stringify(report,null,2))
}finally{await db.close()}
