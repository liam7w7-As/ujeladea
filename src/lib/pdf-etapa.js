import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import { prepararInformeEtapa } from './informe-etapa.js'
import { getLogoBase64 } from './pdf.js'

const bordO = [143,25,55], oro = [212,160,23], tinta = [30,30,45], gris = [100,100,110]

export function crearDocumentoInformeEtapa(informe, { logo } = {}) {
  const doc = new jsPDF({ unit:'mm', format:'a4' })
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight()
  const M = 16, ancho = W - 2*M
  let y = 48
  doc.setProperties({ title: 'Informe de etapa - ' + informe.etiqueta, author: 'UJELADEA', subject: informe.provisional ? 'Resultados provisionales' : 'Resultados archivados' })
  function cabecera() {
    doc.setFillColor(...bordO); doc.rect(0,0,W,35,'F')
    doc.setFillColor(...oro); doc.rect(0,35,W,1.5,'F')
    if (logo) doc.addImage(logo,'PNG',M,7,20,20)
    const x = logo ? M+26 : M
    doc.setFont('helvetica','bold'); doc.setFontSize(12); doc.setTextColor(255,255,255)
    doc.text('OLIMPIADAS BÍBLICAS UJELADEA ' + informe.etapa.anio,x,14)
    doc.setFont('helvetica','normal'); doc.setFontSize(8)
    doc.text(doc.splitTextToSize(informe.etiqueta,W-M-x),x,21)
    doc.setFontSize(7); doc.setTextColor(242,214,222)
    doc.text(informe.ejemplo ? 'EJEMPLO - DATOS FICTICIOS' : informe.provisional ? 'INFORME PROVISIONAL' : 'ETAPA CERRADA - RESULTADOS ARCHIVADOS',x,29)
  }
  function espacio(alto) { if (y+alto > H-22) { doc.addPage(); cabecera(); y=45 } }
  function titulo(texto) {
    espacio(18)
    doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(...bordO)
    doc.text(texto,M,y); y+=7
  }
  function parrafo(texto, size=8.5) {
    doc.setFont('helvetica','normal'); doc.setFontSize(size); doc.setTextColor(...tinta)
    const lineas = doc.splitTextToSize(texto,ancho)
    for (const linea of lineas) { espacio(5); doc.setFont('helvetica','normal'); doc.setFontSize(size); doc.setTextColor(...tinta); doc.text(linea,M,y); y+=4.6 }
    y+=3
  }
  function tabla(head,body,widths) {
    autoTable(doc, { startY:y, head:[head], body,
      margin:{ top:44, bottom:22, left:M, right:M }, tableWidth:ancho,
      styles:{ font:'helvetica', fontSize:8, cellPadding:2.5, overflow:'linebreak', textColor:tinta, valign:'middle' },
      headStyles:{ fillColor:bordO, textColor:[255,255,255], fontStyle:'bold', fontSize:7.5 },
      alternateRowStyles:{fillColor:[248,246,248]}, rowPageBreak:'avoid',
      columnStyles:Object.fromEntries(widths.map((w,i)=>[i,{cellWidth:w}])),
      willDrawPage: () => { if (doc.internal.getCurrentPageInfo().pageNumber > 1) cabecera() },
    })
    y=doc.lastAutoTable.finalY+9
  }
  cabecera()
  titulo('Informe de la etapa para el jurado y la directiva')
  const fecha = new Intl.DateTimeFormat('es-BO',{timeZone:'America/La_Paz',dateStyle:'long',timeStyle:'short'}).format(new Date(informe.emitidoAt))
  parrafo('Emitido: ' + fecha + ' (Bolivia). Código de etapa: ' + informe.etapa.codigo,8)
  parrafo('Configuración de la etapa: ' + informe.etapa.cantidad_preguntas + ' preguntas por intento y ' + informe.etapa.tiempo_limite + ' minutos por sesión. El plazo es común a todos los dispositivos de la sala.')
  if (informe.motivos.length) {
    titulo('Estado de los resultados')
    for (const motivo of informe.motivos) parrafo('- ' + motivo)
  } else parrafo('Etapa cerrada. El informe se preparó con el archivo de esta etapa.')
  titulo('Participación y avance')
  const r = informe.resumen
  tabla(['Indicador','Cantidad','Indicador','Cantidad'],[
    ['Sesiones finalizadas / total',r.finalizadas+' / '+r.sesiones,'Sesiones abiertas',String(r.abiertas)],
    ['Jóvenes convocados',String(r.convocados),'Intentos registrados',String(r.registrados)],
    ['Convocados sin registro',String(r.sinRegistro),'Intentos terminados',String(r.terminados)],
    ['Preguntas asignadas',String(r.asignadas),'Respuestas confirmadas',String(r.respondidas)],
    ['Preguntas sin responder',String(r.sinResponder),'Respuestas sin calificar',String(r.pendientes)],
  ],[64,25,64,25])
  titulo('Rendimiento por sociedad')
  parrafo('Promedio de las notas individuales sobre 100. Sin descuentos por alertas ni criterio de censo.',8)
  if(!informe.sociedades.length) parrafo('Todavía no hay sociedades evaluadas.')
  else tabla(['Pos.','Sociedad / iglesia','Evaluados','Puntos / máximo','Nota / 100','Pend.'],informe.sociedades.map((s,i)=>[
    String(s.posicion??i+1),s.sociedad+'\n'+s.iglesia,String(s.rindieron),s.puntajeObtenido+' / '+s.puntajeMaximo,s.porcentaje.toFixed(2),String(s.pendientes),
  ]),[12,58,23,34,29,22])
  titulo('Hasta diez participantes según el orden actual')
  parrafo('Solo se incluyen intentos de sesiones finalizadas. Una nota pendiente conserva su carácter parcial aunque aparezca en este listado.',8)
  if (!informe.jovenes.length) parrafo('Todavía no hay participantes evaluados en sesiones finalizadas.')
  else tabla(['Pos.','Participante / sociedad','Puntos / máximo','Efectividad','Duración','Pend.'],informe.jovenes.map((j,i)=>[
    String(j.posicion??i+1),j.nombre+'\n'+j.sociedad,j.puntaje+' / '+j.maximo,j.maximo ? j.efectividad.toFixed(2)+' / 100' : 'N/D',j.duracion,String(j.pendientes),
  ]),[12,66,30,26,26,18])
  espacio(100)
  titulo('Cómo interpretar este informe')
  for (const texto of informe.metodologia) parrafo(texto)
  const paginas = doc.internal.getNumberOfPages()
  for (let n=1;n<=paginas;n++) {
    doc.setPage(n); doc.setDrawColor(220,215,220); doc.line(M,H-16,W-M,H-16)
    doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(...gris)
    doc.text('UJELADEA | ' + informe.etapa.libro + ' ' + informe.etapa.anio + ' | ' + (informe.provisional ? 'Provisional' : 'Archivo cerrado'),M,H-10)
    doc.text('Página '+n+' de '+paginas,W-M,H-10,{align:'right'})
  }
  return doc
}

export async function generarInformeEtapaV2({ etapa, datos, nombreArchivo }) {
  const informe = prepararInformeEtapa({ etapa, datos })
  const logo = await getLogoBase64('/logo.png')
  const doc = crearDocumentoInformeEtapa(informe,{logo})
  const url = URL.createObjectURL(doc.output('blob'))
  const win = window.open(url,'_blank')
  if (win) win.document.title = nombreArchivo || 'Informe de ' + etapa.libro
  else { URL.revokeObjectURL(url); doc.save(nombreArchivo || 'Informe_'+etapa.codigo+'.pdf') }
}
