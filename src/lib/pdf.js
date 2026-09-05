import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

// Colores institucionales
const C = {
  primary:   [143, 25, 55],   // Bordó oscuro
  primaryLt: [180, 50, 80],   // Bordó claro
  accent:    [212, 160, 23],  // Dorado
  dark:      [30, 30, 45],    // Casi negro
  gray:      [100, 100, 110], // Gris medio
  lightGray: [240, 238, 242], // Gris muy claro
  white:     [255, 255, 255],
  success:   [39, 174, 96],
  warning:   [230, 126, 34],
  error:     [192, 57, 43],
}

// Cargar imagen como base64 circular
function getLogoBase64(imageUrl) {
  return new Promise((resolve) => {
    const img = new Image()
    img.setAttribute('crossOrigin', 'anonymous')
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const size = Math.min(img.width, img.height)
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      ctx.beginPath()
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2, true)
      ctx.closePath()
      ctx.clip()
      const srcX = (img.width - size) / 2
      const srcY = (img.height - size) / 2
      ctx.drawImage(img, srcX, srcY, size, size, 0, 0, size, size)
      ctx.beginPath()
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2, true)
      ctx.lineWidth = size * 0.03
      ctx.strokeStyle = '#8f1937'
      ctx.stroke()
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => resolve(null)
    img.src = imageUrl
  })
}

// Helper: dibujar rect redondeado
function roundedRect(doc, x, y, w, h, r, fillColor) {
  doc.setFillColor(...fillColor)
  doc.roundedRect(x, y, w, h, r, r, 'F')
}

// Helper: texto centrado en un ancho
function textCentered(doc, text, x, y, w) {
  const tw = doc.getStringUnitWidth(text) * doc.getFontSize() / doc.internal.scaleFactor
  doc.text(text, x + (w - tw) / 2, y)
}

// ─────────────────────────────────────────────────────────────────────────────
//  REPORTE DE RESULTADOS (con estadísticas enriquecidas)
// ─────────────────────────────────────────────────────────────────────────────
export const generarReporteResultados = async ({
  sesion,          // { nombre sociedad, iglesia, ... }
  estadisticas,    // objeto completo de calcularPuntajeSociedad
  participantes,   // array con { nombre, del_censo, puntaje_total, pendientes }
  nombreArchivo,
}) => {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const PW = doc.internal.pageSize.getWidth()
  const PH = doc.internal.pageSize.getHeight()
  const MARGIN = 14

  // ── BANDA SUPERIOR ──────────────────────────────────────────────────────────
  doc.setFillColor(...C.primary)
  doc.rect(0, 0, PW, 38, 'F')

  // Degradado inferior de la banda (simulado con un rect más claro)
  doc.setFillColor(...C.primaryLt)
  doc.rect(0, 34, PW, 4, 'F')

  // Logo
  try {
    const logoData = await getLogoBase64('/logo.png')
    if (logoData) doc.addImage(logoData, 'PNG', MARGIN, 6, 22, 22)
  } catch (_) {}

  // Nombre institución
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.setTextColor(...C.white)
  doc.text('OLIMPIADAS BÍBLICAS UJELADEA 2026', 42, 15)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(240, 210, 220)
  doc.text('1ra Etapa — HEBREOS', 42, 21)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(225, 195, 210)
  doc.text('Reporte Oficial de Resultados', 42, 27)

  // Fecha (derecha)
  const fechaStr = new Date().toLocaleDateString('es-ES', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  })
  doc.setFontSize(7.5)
  doc.setTextColor(210, 185, 195)
  doc.text(fechaStr, PW - MARGIN, 22, { align: 'right' })

  // ── SUBTÍTULO DE SECCIÓN ───────────────────────────────────────────────────
  let cursorY = 48

  // Nombre sociedad e iglesia
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(...C.dark)
  doc.text(sesion.sociedad, MARGIN, cursorY)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...C.gray)
  doc.text(sesion.iglesia || '', MARGIN, cursorY + 6)

  // Fecha del examen (derecha)
  const fechaExamen = new Date(sesion.fecha).toLocaleDateString('es-ES', {
    year: 'numeric', month: 'long', day: 'numeric'
  })
  doc.setFontSize(8)
  doc.text(`Examen realizado: ${fechaExamen}`, PW - MARGIN, cursorY + 3, { align: 'right' })

  // Línea separadora
  cursorY += 14
  doc.setDrawColor(...C.lightGray)
  doc.setLineWidth(0.5)
  doc.line(MARGIN, cursorY, PW - MARGIN, cursorY)
  cursorY += 6

  // ── TARJETAS DE ESTADÍSTICAS ───────────────────────────────────────────────
  const isPendiente = estadisticas.pendientesIA > 0

  // Definir tarjetas según estado
  const tarjetas = isPendiente
    ? [
        { label: 'Estado', value: 'PENDIENTE', sub: `${estadisticas.pendientesIA} resp. sin calificar`, color: C.warning },
        { label: 'Participaron', value: `${estadisticas.rindieron}`, sub: 'jóvenes', color: C.primary },
        { label: 'Puntaje parcial', value: `${estadisticas.puntajeObtenido}`, sub: `de ${estadisticas.puntajeMaximo} pts`, color: C.gray },
      ]
    : [
        { label: 'Efectividad', value: `${estadisticas.porcentaje}%`, sub: estadisticas.penalizacionPorcentaje > 0 ? `(bruto ${estadisticas.porcentajeBruto}% - ${estadisticas.penalizacionPorcentaje}% pen.)` : 'sobre el total posible', color: estadisticas.porcentaje >= 80 ? C.success : estadisticas.porcentaje >= 60 ? C.warning : C.error },
        { label: 'Participaron', value: `${estadisticas.rindieron}`, sub: estadisticas.totalCenso ? `de ${estadisticas.totalCenso} en censo` : 'jóvenes', color: C.primary },
        { label: 'Puntaje Obtenido', value: `${estadisticas.puntajeObtenido}`, sub: `de ${estadisticas.puntajeMaximo} pts posibles`, color: C.dark },
        { label: 'Promedio x Joven', value: `${estadisticas.promedioPorParticipante}`, sub: 'puntos por participante', color: [46, 134, 193] },
      ]

  const cardW = (PW - MARGIN * 2 - (tarjetas.length - 1) * 4) / tarjetas.length
  tarjetas.forEach((t, i) => {
    const cx = MARGIN + i * (cardW + 4)
    roundedRect(doc, cx, cursorY, cardW, 22, 2, C.lightGray)
    // Banda de color izquierda
    doc.setFillColor(...t.color)
    doc.roundedRect(cx, cursorY, 3, 22, 1, 1, 'F')
    // Etiqueta
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...C.gray)
    doc.text(t.label.toUpperCase(), cx + 6, cursorY + 6)
    // Valor principal
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.setTextColor(...t.color)
    doc.text(t.value, cx + 6, cursorY + 14)
    // Sub
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6)
    doc.setTextColor(...C.gray)
    const subLines = doc.splitTextToSize(t.sub, cardW - 10)
    doc.text(subLines, cx + 6, cursorY + 19)
  })

  cursorY += 28

  // Alertas si las hay
  if (estadisticas.totalAlertas > 0) {
    roundedRect(doc, MARGIN, cursorY, PW - MARGIN * 2, 12, 2, [255, 240, 240])
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(...C.error)
    doc.text(`⚠  Alertas de Seguridad: ${estadisticas.totalAlertas}`, MARGIN + 4, cursorY + 5)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...C.gray)
    const escalaTexto = '  Escala: 0-19 = sin rebaja  •  20-29 = -5%  •  30-39 = -10%  •  40+ = -15%'
    doc.text(escalaTexto, MARGIN + 4, cursorY + 10)
    cursorY += 17
  }

  cursorY += 4

  // ── TÍTULO TABLA ────────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...C.dark)
  doc.text('Detalle por Participante', MARGIN, cursorY)
  cursorY += 6

  // ── TABLA DE PARTICIPANTES ─────────────────────────────────────────────────
  const cols = ['#', 'Nombre del Joven', 'Del Censo', 'Puntaje / Máx.', 'Efectividad', 'Alertas', 'Estado']
  const rows = participantes.map((p, idx) => {
    const efectividad = p.puntaje_max > 0
      ? `${Math.round(((p.puntaje_total ?? 0) / p.puntaje_max) * 100)}%`
      : '—'
    return [
      `${idx + 1}°`,
      p.nombre,
      p.del_censo ? 'Sí' : 'Invitado',
      `${p.puntaje_total ?? 0} / ${p.puntaje_max ?? '?'} pts`,
      efectividad,
      p.alertas > 0 ? `${p.alertas}` : '—',
      p.pendientes > 0 ? `${p.pendientes} pend.` : '✓ Completo',
    ]
  })

  autoTable(doc, {
    startY: cursorY,
    margin: { left: MARGIN, right: MARGIN },
    head: [cols],
    body: rows,
    theme: 'plain',
    headStyles: {
      fillColor: C.primary,
      textColor: C.white,
      fontStyle: 'bold',
      fontSize: 7.5,
      cellPadding: { top: 4, bottom: 4, left: 3, right: 3 },
    },
    bodyStyles: {
      fontSize: 8,
      cellPadding: { top: 3.5, bottom: 3.5, left: 3, right: 3 },
      textColor: C.dark,
    },
    alternateRowStyles: {
      fillColor: [248, 246, 250],
    },
    columnStyles: {
      0: { halign: 'center', fontStyle: 'bold', cellWidth: 10, textColor: C.primary },
      1: { fontStyle: 'bold', cellWidth: 55 },
      2: { halign: 'center', cellWidth: 18 },
      3: { halign: 'center', fontStyle: 'bold', cellWidth: 32 },
      4: { halign: 'center', cellWidth: 20 },
      5: { halign: 'center', cellWidth: 16 },
      6: { halign: 'center', cellWidth: 22 },
    },
    didParseCell: (data) => {
      if (data.section !== 'body') return
      // Estado (col 6)
      if (data.column.index === 6) {
        const raw = data.row.raw[6]
        if (raw && raw.includes('pend.')) {
          data.cell.styles.textColor = C.warning
          data.cell.styles.fontStyle = 'bold'
        } else if (raw === '✓ Completo') {
          data.cell.styles.textColor = C.success
        }
      }
      // Alertas (col 5) — rojo si >= 20
      if (data.column.index === 5) {
        const val = parseInt(data.row.raw[5])
        if (!isNaN(val) && val >= 20) {
          data.cell.styles.textColor = C.error
          data.cell.styles.fontStyle = 'bold'
        } else if (!isNaN(val) && val > 0) {
          data.cell.styles.textColor = C.warning
          data.cell.styles.fontStyle = 'bold'
        }
      }
      // Puntaje (col 3) — color acento
      if (data.column.index === 3) {
        data.cell.styles.textColor = C.primary
      }
      // Efectividad (col 4) — color según rendimiento
      if (data.column.index === 4) {
        const val = parseInt(data.row.raw[4])
        if (!isNaN(val)) {
          data.cell.styles.textColor = val >= 80 ? C.success : val >= 60 ? C.warning : C.error
          data.cell.styles.fontStyle = 'bold'
        }
      }
    },
    didDrawPage: (data) => {
      // ── PIE DE PÁGINA ──────────────────────────────────────────────────────
      const pageNum = doc.internal.getNumberOfPages()

      // Banda pie
      doc.setFillColor(...C.lightGray)
      doc.rect(0, PH - 14, PW, 14, 'F')

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(...C.gray)
      doc.text('OLIMPIADAS BÍBLICAS UJELADEA 2026 — 1ra Etapa HEBREOS', MARGIN, PH - 6)
      doc.text(`Página ${pageNum}`, PW - MARGIN, PH - 6, { align: 'right' })
    },
  })

  // ── ABRIR EN NUEVA PESTAÑA ─────────────────────────────────────────────────
  const blob = doc.output('blob')
  const url = URL.createObjectURL(blob)
  const win = window.open(url, '_blank')
  if (win) win.document.title = nombreArchivo || 'Reporte'
  else doc.save(nombreArchivo || 'reporte.pdf')
}

// ─────────────────────────────────────────────────────────────────────────────
//  REPORTE GENÉRICO (Ranking, Banco de Preguntas, etc.)
// ─────────────────────────────────────────────────────────────────────────────
export const generarReportePDF = async ({ titulo, subtitulo, columnas, filas, nombreArchivo }) => {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const PW = doc.internal.pageSize.getWidth()
  const PH = doc.internal.pageSize.getHeight()
  const MARGIN = 14

  // Banda superior
  doc.setFillColor(...C.primary)
  doc.rect(0, 0, PW, 32, 'F')
  doc.setFillColor(...C.primaryLt)
  doc.rect(0, 28, PW, 4, 'F')

  // Logo
  try {
    const logoData = await getLogoBase64('/logo.png')
    if (logoData) doc.addImage(logoData, 'PNG', MARGIN, 5, 18, 18)
  } catch (_) {}

  // Títulos en banda
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(...C.white)
  doc.text('OLIMPIADAS BÍBLICAS UJELADEA 2026', 37, 13)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(240, 210, 220)
  doc.text('1ra Etapa — HEBREOS', 37, 19)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(225, 195, 210)
  doc.text(titulo, 37, 26)

  // Fecha
  const fechaStr = new Date().toLocaleDateString('es-ES', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
  doc.setFontSize(7)
  doc.setTextColor(210, 185, 195)
  doc.text(fechaStr, PW - MARGIN, 14, { align: 'right' })

  let cursorY = 42

  // Subtítulo si existe
  if (subtitulo) {
    roundedRect(doc, MARGIN, cursorY, PW - MARGIN * 2, 0, 2, C.lightGray)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...C.gray)
    const lines = doc.splitTextToSize(subtitulo, PW - MARGIN * 2 - 8)
    roundedRect(doc, MARGIN, cursorY, PW - MARGIN * 2, lines.length * 5 + 6, 2, C.lightGray)
    doc.text(lines, MARGIN + 4, cursorY + 5)
    cursorY += lines.length * 5 + 10
  }

  // Tabla
  autoTable(doc, {
    startY: cursorY,
    margin: { left: MARGIN, right: MARGIN },
    head: [columnas],
    body: filas,
    theme: 'plain',
    headStyles: {
      fillColor: C.primary,
      textColor: C.white,
      fontStyle: 'bold',
      fontSize: 8,
      cellPadding: { top: 4, bottom: 4, left: 4, right: 4 },
    },
    bodyStyles: {
      fontSize: 8.5,
      cellPadding: { top: 3.5, bottom: 3.5, left: 4, right: 4 },
      textColor: C.dark,
    },
    alternateRowStyles: {
      fillColor: [248, 246, 250],
    },
    columnStyles: {
      0: { halign: 'center', fontStyle: 'bold', cellWidth: 18, textColor: C.primary },
    },
    didDrawPage: (data) => {
      const pageNum = doc.internal.getNumberOfPages()
      doc.setFillColor(...C.lightGray)
      doc.rect(0, PH - 14, PW, 14, 'F')
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(...C.gray)
      doc.text('OLIMPIADAS BÍBLICAS UJELADEA 2026 — 1ra Etapa HEBREOS', MARGIN, PH - 6)
      doc.text(`Página ${pageNum}`, PW - MARGIN, PH - 6, { align: 'right' })
    },
  })

  const blob = doc.output('blob')
  const url = URL.createObjectURL(blob)
  const win = window.open(url, '_blank')
  if (win) win.document.title = nombreArchivo || 'Reporte'
  else doc.save(nombreArchivo || 'reporte.pdf')
}

// ─────────────────────────────────────────────────────────────────────────────
//  REPORTE INDIVIDUAL POR PARTICIPANTE (Detalle Pregunta por Pregunta)
// ─────────────────────────────────────────────────────────────────────────────
export const generarReporteIndividual = async ({
  sesion,        // { sociedad, iglesia, fecha }
  participante,  // { nombre, del_censo, puntaje_total, puntaje_max, alertas, pendientes }
  respuestas,    // array de respuestas con preguntas (texto, respuesta_correcta, puntaje, tipo)
  nombreArchivo,
}) => {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const PW = doc.internal.pageSize.getWidth()
  const PH = doc.internal.pageSize.getHeight()
  const MARGIN = 14

  // ── BANDA SUPERIOR ──────────────────────────────────────────────────────────
  doc.setFillColor(...C.primary)
  doc.rect(0, 0, PW, 38, 'F')

  doc.setFillColor(...C.primaryLt)
  doc.rect(0, 34, PW, 4, 'F')

  // Logo
  try {
    const logoData = await getLogoBase64('/logo.png')
    if (logoData) doc.addImage(logoData, 'PNG', MARGIN, 6, 22, 22)
  } catch (_) {}

  // Títulos
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.setTextColor(...C.white)
  doc.text('OLIMPIADAS BÍBLICAS UJELADEA 2026', 42, 15)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(240, 210, 220)
  doc.text('1ra Etapa — HEBREOS', 42, 21)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(225, 195, 210)
  doc.text('Reporte Individual de Respuestas', 42, 27)

  // Fecha generación
  const fechaStr = new Date().toLocaleDateString('es-ES', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  })
  doc.setFontSize(7.5)
  doc.setTextColor(210, 185, 195)
  doc.text(fechaStr, PW - MARGIN, 22, { align: 'right' })

  // ── DETALLES DEL JOVEN Y SOCIEDAD ──────────────────────────────────────────
  let cursorY = 48

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(...C.dark)
  doc.text(participante.nombre, MARGIN, cursorY)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...C.gray)
  doc.text(`${sesion.sociedad || 'Sociedad'} ${sesion.iglesia ? '• ' + sesion.iglesia : ''} • ${participante.del_censo ? 'Miembro Oficial (Censo)' : 'Invitado'}`, MARGIN, cursorY + 6)

  const fechaExamen = sesion.fecha ? new Date(sesion.fecha).toLocaleDateString('es-ES', {
    year: 'numeric', month: 'long', day: 'numeric'
  }) : ''
  if (fechaExamen) {
    doc.setFontSize(8)
    doc.text(`Examen realizado: ${fechaExamen}`, PW - MARGIN, cursorY + 3, { align: 'right' })
  }

  // Separador
  cursorY += 13
  doc.setDrawColor(...C.lightGray)
  doc.setLineWidth(0.5)
  doc.line(MARGIN, cursorY, PW - MARGIN, cursorY)
  cursorY += 6

  // ── TARJETAS RESUMEN DEL JOVEN ──────────────────────────────────────────────
  const totalPreguntas = respuestas.length
  const correctas = respuestas.filter(r => r.es_correcta === true).length
  const incorrectas = respuestas.filter(r => r.es_correcta === false && r.calificado_por !== 'pendiente_ia' && r.puntaje_obtenido !== null).length
  const pendientes = respuestas.filter(r => r.calificado_por === 'pendiente_ia' || r.puntaje_obtenido === null).length
  const puntajeObtenido = participante.puntaje_total ?? 0
  const puntajeMaximo = participante.puntaje_max ?? respuestas.reduce((sum, r) => sum + (r.preguntas?.puntaje || 0), 0)
  const efectividad = puntajeMaximo > 0 ? Math.round((puntajeObtenido / puntajeMaximo) * 100) : 0

  const tarjetas = [
    {
      label: 'Puntaje Obtenido',
      value: `${puntajeObtenido} / ${puntajeMaximo}`,
      sub: `${efectividad}% de efectividad`,
      color: efectividad >= 80 ? C.success : efectividad >= 60 ? C.warning : C.error
    },
    {
      label: 'Respuestas',
      value: `${correctas} / ${totalPreguntas}`,
      sub: `${correctas} corr. • ${incorrectas} incorr.`,
      color: C.primary
    },
    {
      label: 'Evaluación',
      value: pendientes > 0 ? `${pendientes} PEND.` : 'COMPLETO',
      sub: pendientes > 0 ? 'Preguntas por evaluar' : '100% Calificado',
      color: pendientes > 0 ? C.warning : C.success
    },
    {
      label: 'Seguridad',
      value: `${participante.alertas || 0}`,
      sub: (participante.alertas || 0) >= 20 ? 'Alertas críticas' : (participante.alertas || 0) > 0 ? 'Alertas leves' : 'Sin incidentes',
      color: (participante.alertas || 0) >= 20 ? C.error : (participante.alertas || 0) > 0 ? C.warning : C.success
    }
  ]

  const cardW = (PW - MARGIN * 2 - (tarjetas.length - 1) * 4) / tarjetas.length
  tarjetas.forEach((t, i) => {
    const cx = MARGIN + i * (cardW + 4)
    roundedRect(doc, cx, cursorY, cardW, 22, 2, C.lightGray)
    // Banda de color izquierda
    doc.setFillColor(...t.color)
    doc.roundedRect(cx, cursorY, 3, 22, 1, 1, 'F')
    // Etiqueta
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...C.gray)
    doc.text(t.label.toUpperCase(), cx + 6, cursorY + 6)
    // Valor
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(...t.color)
    doc.text(t.value, cx + 6, cursorY + 14)
    // Sub
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6)
    doc.setTextColor(...C.gray)
    const subLines = doc.splitTextToSize(t.sub, cardW - 10)
    doc.text(subLines, cx + 6, cursorY + 19)
  })

  cursorY += 28

  // ── TABLA DETALLADA DE PREGUNTAS ───────────────────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...C.dark)
  doc.text('Detalle de Preguntas y Respuestas', MARGIN, cursorY)
  cursorY += 5

  const cols = ['#', 'Pregunta', 'Respuesta del Joven', 'Respuesta Correcta / Referencia', 'Puntos', 'Estado']
  const rows = respuestas.map((r, idx) => {
    const pMax = r.preguntas?.puntaje || 0
    const pObt = r.puntaje_obtenido ?? 0
    const isPend = r.calificado_por === 'pendiente_ia' || r.puntaje_obtenido === null
    const estado = isPend ? 'Pendiente' : r.es_correcta ? 'Correcta' : 'Incorrecta'

    return [
      `${idx + 1}`,
      r.preguntas?.texto || '—',
      r.respuesta_dada || '(Sin respuesta)',
      r.preguntas?.respuesta_correcta || '—',
      isPend ? `? / ${pMax} pts` : `${pObt} / ${pMax} pts`,
      estado
    ]
  })

  autoTable(doc, {
    startY: cursorY,
    margin: { left: MARGIN, right: MARGIN },
    head: [cols],
    body: rows,
    theme: 'plain',
    headStyles: {
      fillColor: C.primary,
      textColor: C.white,
      fontStyle: 'bold',
      fontSize: 7.5,
      cellPadding: { top: 3.5, bottom: 3.5, left: 3, right: 3 },
    },
    bodyStyles: {
      fontSize: 7.5,
      cellPadding: { top: 3, bottom: 3, left: 3, right: 3 },
      textColor: C.dark,
    },
    alternateRowStyles: {
      fillColor: [248, 246, 250],
    },
    columnStyles: {
      0: { halign: 'center', fontStyle: 'bold', cellWidth: 8, textColor: C.primary },
      1: { cellWidth: 55 },
      2: { cellWidth: 46 },
      3: { cellWidth: 46 },
      4: { halign: 'center', fontStyle: 'bold', cellWidth: 16 },
      5: { halign: 'center', cellWidth: 17, fontStyle: 'bold' },
    },
    didParseCell: (data) => {
      if (data.section !== 'body') return
      // Estado (col 5)
      if (data.column.index === 5) {
        const raw = data.row.raw[5]
        if (raw === 'Correcta') {
          data.cell.styles.textColor = C.success
        } else if (raw === 'Incorrecta') {
          data.cell.styles.textColor = C.error
        } else if (raw === 'Pendiente') {
          data.cell.styles.textColor = C.warning
        }
      }
      // Puntos (col 4)
      if (data.column.index === 4) {
        const rawEstado = data.row.raw[5]
        if (rawEstado === 'Correcta') {
          data.cell.styles.textColor = C.success
        } else if (rawEstado === 'Incorrecta') {
          data.cell.styles.textColor = C.error
        }
      }
    },
    didDrawPage: (data) => {
      const pageNum = doc.internal.getNumberOfPages()
      doc.setFillColor(...C.lightGray)
      doc.rect(0, PH - 14, PW, 14, 'F')

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(...C.gray)
      doc.text(`OLIMPIADAS BÍBLICAS UJELADEA 2026 — Participante: ${participante.nombre}`, MARGIN, PH - 6)
      doc.text(`Página ${pageNum}`, PW - MARGIN, PH - 6, { align: 'right' })
    },
  })

  const blob = doc.output('blob')
  const url = URL.createObjectURL(blob)
  const win = window.open(url, '_blank')
  if (win) win.document.title = nombreArchivo || `Examen_${participante.nombre}`
  else doc.save(nombreArchivo || `Examen_${participante.nombre}.pdf`)
}

// ─────────────────────────────────────────────────────────────────────────────
//  INFORME EJECUTIVO OFICIAL PARA LA DIRECTIVA DE UJELADEA
// ─────────────────────────────────────────────────────────────────────────────
export const generarInformeEjecutivoDirectiva = async ({
  rankingSociedades = [],
  rankingDisciplina = [],
  topJovenes = [],
  metricasGlobales = {},
  nombreArchivo = 'Informe_Oficial_Directiva_UJELADEA.pdf'
}) => {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const PW = doc.internal.pageSize.getWidth()
  const PH = doc.internal.pageSize.getHeight()
  const MARGIN = 14
  const CONTENT_W = PW - MARGIN * 2

  // ── BANDA SUPERIOR INSTITUCIONAL ──────────────────────────────────────────
  doc.setFillColor(...C.primary)
  doc.rect(0, 0, PW, 38, 'F')

  doc.setFillColor(...C.primaryLt)
  doc.rect(0, 34, PW, 4, 'F')

  // Logo institucional
  try {
    const logoData = await getLogoBase64('/logo.png')
    if (logoData) doc.addImage(logoData, 'PNG', MARGIN, 6, 22, 22)
  } catch (_) {}

  // Títulos institucionales
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...C.accent)
  doc.text('UNIÓN DE JÓVENES EVANGÉLICOS LUTERANOS (UJELADEA)', 42, 13)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(...C.white)
  doc.text('OLIMPIADAS BÍBLICAS 2026 — FASE 1: HEBREOS', 42, 20)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(240, 215, 225)
  doc.text('INFORME EJECUTIVO DE EVALUACIÓN GENERAL Y AUDITORÍA DE RESULTADOS', 42, 27)

  // Badge Directiva / Fecha
  roundedRect(doc, PW - MARGIN - 48, 8, 48, 8, 2, [180, 40, 70])
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...C.white)
  textCentered(doc, 'USO OFICIAL / DIRECTIVA', PW - MARGIN - 48, 13.5, 48)

  const fechaEmision = new Date().toLocaleDateString('es-ES', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(230, 200, 210)
  doc.text(`Emisión: ${fechaEmision}`, PW - MARGIN, 22, { align: 'right' })

  let cursorY = 44

  // ── PANEL DE INDICADORES GLOBALES (KPIs) ──────────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.setTextColor(...C.primary)
  doc.text('PANEL EJECUTIVO DE INDICADORES GENERALES', MARGIN, cursorY)
  cursorY += 4

  const kpiW = (CONTENT_W - 8) / 3
  const kpiH = 15

  const kpis = [
    {
      label: 'SOCIEDADES EVALUADAS',
      val: `${metricasGlobales.totalSociedades || rankingSociedades.length}`,
      sub: 'Todas con sesión cerrada',
      color: C.primary
    },
    {
      label: 'JÓVENES PARTICIPANTES',
      val: `${metricasGlobales.totalJovenes || 0}`,
      sub: 'Evaluaciones registradas',
      color: C.dark
    },
    {
      label: 'EFECTIVIDAD GENERAL',
      val: `${metricasGlobales.promedioGeneralTorneo || 0}%`,
      sub: `Promedio: ${metricasGlobales.promedioPuntosTorneo || 0} pts`,
      color: C.success
    },
    {
      label: 'MEJOR NOTA INDIVIDUAL',
      val: metricasGlobales.mejorNota ? `${metricasGlobales.mejorNota.puntaje} pts` : 'N/D',
      sub: metricasGlobales.mejorNota ? `${metricasGlobales.mejorNota.nombre.slice(0, 22)}` : '',
      color: C.accent
    },
    {
      label: 'EXAMEN MÁS VELOZ',
      val: metricasGlobales.mejorTiempo ? metricasGlobales.mejorTiempo.duracionTexto : 'N/D',
      sub: metricasGlobales.mejorTiempo ? `${metricasGlobales.mejorTiempo.nombre.slice(0, 22)}` : '',
      color: [41, 128, 185]
    },
    {
      label: 'JUEGO LIMPIO / AUDITORÍA',
      val: `${metricasGlobales.totalAlertasTorneo || 0} alertas`,
      sub: metricasGlobales.sociedadMasDisciplinada ? `Menos: ${metricasGlobales.sociedadMasDisciplinada.sociedad.slice(0, 16)}` : 'Auditoría en regla',
      color: (metricasGlobales.totalAlertasTorneo || 0) > 30 ? C.warning : C.success
    }
  ]

  kpis.forEach((kpi, idx) => {
    const col = idx % 3
    const row = Math.floor(idx / 3)
    const x = MARGIN + col * (kpiW + 4)
    const y = cursorY + row * (kpiH + 3)

    roundedRect(doc, x, y, kpiW, kpiH, 2, C.lightGray)

    // Borde izquierdo de color
    doc.setFillColor(...kpi.color)
    doc.rect(x, y, 2.5, kpiH, 'F')

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6)
    doc.setTextColor(...C.gray)
    doc.text(kpi.label, x + 5, y + 4.5)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(...kpi.color)
    doc.text(kpi.val, x + 5, y + 9.5)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6)
    doc.setTextColor(...C.dark)
    doc.text(kpi.sub, x + 5, y + 13)
  })

  cursorY += (kpiH * 2) + 9

  // ── PODIO DESTACADO DE SOCIEDADES (TOP 3) ─────────────────────────────────
  if (rankingSociedades.length >= 3) {
    const podioW = (CONTENT_W - 8) / 3
    const podioH = 18

    const top3 = [
      { item: rankingSociedades[0], titulo: '1° LUGAR — CAMPEÓN', icon: 'ORO', bg: [255, 248, 230], border: C.accent, txt: [180, 130, 20] },
      { item: rankingSociedades[1], titulo: '2° LUGAR — SUBCAMPEÓN', icon: 'PLATA', bg: [248, 249, 250], border: [160, 160, 170], txt: [110, 110, 120] },
      { item: rankingSociedades[2], titulo: '3° LUGAR — TERCER PUESTO', icon: 'BRONCE', bg: [254, 246, 240], border: [205, 127, 50], txt: [160, 95, 40] }
    ]

    top3.forEach((pod, idx) => {
      const x = MARGIN + idx * (podioW + 4)
      roundedRect(doc, x, cursorY, podioW, podioH, 2, pod.bg)

      // Borde decorativo
      doc.setDrawColor(...pod.border)
      doc.setLineWidth(0.5)
      doc.roundedRect(x, cursorY, podioW, podioH, 2, 2, 'D')

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7)
      doc.setTextColor(...pod.txt)
      doc.text(pod.titulo, x + 4, cursorY + 4.5)

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8.5)
      doc.setTextColor(...C.dark)
      doc.text(pod.item.sociedad.slice(0, 24), x + 4, cursorY + 9.5)

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6.5)
      doc.setTextColor(...C.gray)
      doc.text(`${pod.item.iglesia} • ${pod.item.rindieron} jóvenes`, x + 4, cursorY + 13)

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8)
      doc.setTextColor(...C.primary)
      doc.text(`${pod.item.porcentaje}%`, x + podioW - 4, cursorY + 9.5, { align: 'right' })

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6)
      doc.setTextColor(...C.gray)
      doc.text(`${pod.item.promedioPorParticipante} pts prom`, x + podioW - 4, cursorY + 13, { align: 'right' })
    })

    cursorY += podioH + 7
  }

  // ── SECCIÓN 1: TABLA GENERAL DE SOCIEDADES ────────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.setTextColor(...C.primary)
  doc.text('1. CLASIFICACIÓN OFICIAL DE SOCIEDADES (Puntaje Ponderado y Efectividad)', MARGIN, cursorY)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...C.gray)
  doc.text('Criterio equitativo: Rendimiento neto de los participantes evaluados menos penalizaciones de seguridad.', MARGIN, cursorY + 3.5)

  cursorY += 5.5

  const columnasSociedades = [
    'Pos.', 'Sociedad de Jóvenes', 'Iglesia', 'Asistencia', 'Puntos Tot.', 'Promedio', 'Alertas', 'Efectividad', 'Distinción'
  ]

  const filasSociedades = rankingSociedades.map((item, idx) => {
    let dist = 'Aprobado'
    if (idx === 0) dist = '🥇 Campeón'
    else if (idx === 1) dist = '🥈 Subcampeón'
    else if (idx === 2) dist = '🥉 3° Puesto'
    else if (item.porcentaje >= 80) dist = 'Destacado'
    else if (item.porcentaje < 60) dist = 'Regular'

    const alertaStr = item.totalAlertas > 0
      ? `${item.totalAlertas}${item.penalizacionPorcentaje > 0 ? ` (-${item.penalizacionPorcentaje}%)` : ''}`
      : '0'

    return [
      `${idx + 1}°`,
      item.sociedad,
      item.iglesia,
      `${item.rindieron}${item.totalCenso ? ` / ${item.totalCenso}` : ''}`,
      `${item.puntajeObtenido} / ${item.puntajeMaximo}`,
      `${item.promedioPorParticipante} pts`,
      alertaStr,
      `${item.porcentaje}%`,
      dist
    ]
  })

  autoTable(doc, {
    startY: cursorY,
    margin: { left: MARGIN, right: MARGIN, bottom: 18 },
    head: [columnasSociedades],
    body: filasSociedades,
    theme: 'plain',
    headStyles: {
      fillColor: C.primary,
      textColor: C.white,
      fontStyle: 'bold',
      fontSize: 7.5,
      cellPadding: { top: 3.5, bottom: 3.5, left: 2.5, right: 2.5 },
      halign: 'center'
    },
    bodyStyles: {
      fontSize: 7.5,
      cellPadding: { top: 2.5, bottom: 2.5, left: 2.5, right: 2.5 },
      textColor: C.dark,
    },
    alternateRowStyles: {
      fillColor: [248, 246, 250],
    },
    columnStyles: {
      0: { halign: 'center', fontStyle: 'bold', cellWidth: 10, textColor: C.primary },
      1: { fontStyle: 'bold', cellWidth: 38 },
      2: { cellWidth: 24 },
      3: { halign: 'center', cellWidth: 18 },
      4: { halign: 'center', cellWidth: 22 },
      5: { halign: 'center', fontStyle: 'bold', cellWidth: 18 },
      6: { halign: 'center', cellWidth: 18 },
      7: { halign: 'center', fontStyle: 'bold', cellWidth: 16 },
      8: { halign: 'center', fontStyle: 'bold', cellWidth: 18 },
    },
    didParseCell: (data) => {
      if (data.section !== 'body') return
      // Efectividad (col 7)
      if (data.column.index === 7) {
        const val = parseInt(data.row.raw[7])
        if (!isNaN(val)) {
          data.cell.styles.textColor = val >= 80 ? C.success : val >= 60 ? C.warning : C.error
        }
      }
      // Alertas (col 6)
      if (data.column.index === 6) {
        const raw = String(data.row.raw[6])
        if (raw.includes('-%') || parseInt(raw) >= 20) {
          data.cell.styles.textColor = C.error
          data.cell.styles.fontStyle = 'bold'
        } else if (raw !== '0') {
          data.cell.styles.textColor = C.warning
        }
      }
      // Distinción (col 8)
      if (data.column.index === 8) {
        if (data.row.index === 0) data.cell.styles.textColor = [180, 130, 20]
        else if (data.row.index === 1) data.cell.styles.textColor = [110, 110, 120]
        else if (data.row.index === 2) data.cell.styles.textColor = [160, 95, 40]
      }
    }
  })

  // Continuar después de la tabla
  cursorY = doc.lastAutoTable.finalY + 8

  // Si no queda espacio para el cuadro individual y firmas en la página actual, saltar de página
  if (cursorY + 60 > PH - 25) {
    doc.addPage()
    cursorY = 20
  }

  // ── SECCIÓN 2: CUADRO DE HONOR INDIVIDUAL (TOP 10 JÓVENES) ─────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.setTextColor(...C.primary)
  doc.text('2. CUADRO DE HONOR INDIVIDUAL — MEJORES NOTAS DEL TORNEO', MARGIN, cursorY)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...C.gray)
  doc.text('Reconocimiento a la excelencia académica bíblica individual, cronometraje y honestidad en la prueba.', MARGIN, cursorY + 3.5)

  cursorY += 5.5

  const columnasJovenes = [
    'Pos.', 'Nombre del Joven', 'Sociedad e Iglesia', 'Puntaje', 'Efectividad', 'Tiempo', 'Alertas', 'Mérito'
  ]

  const filasJovenes = topJovenes.map((j, idx) => {
    let merito = 'Mención de Honor'
    if (idx === 0) merito = '🥇 1er Lugar Individual'
    else if (idx === 1) merito = '🥈 2do Lugar Individual'
    else if (idx === 2) merito = '🥉 3er Lugar Individual'

    return [
      `${idx + 1}°`,
      j.nombre,
      `${j.sociedad}${j.iglesia ? ` (${j.iglesia})` : ''}`,
      `${j.puntaje} / ${j.puntajeMax}`,
      `${j.efectividad}%`,
      j.duracionTexto || 'N/D',
      `${j.alertas || 0}`,
      merito
    ]
  })

  autoTable(doc, {
    startY: cursorY,
    margin: { left: MARGIN, right: MARGIN, bottom: 18 },
    head: [columnasJovenes],
    body: filasJovenes,
    theme: 'plain',
    headStyles: {
      fillColor: [60, 20, 35],
      textColor: C.white,
      fontStyle: 'bold',
      fontSize: 7.5,
      cellPadding: { top: 3.5, bottom: 3.5, left: 2.5, right: 2.5 },
      halign: 'center'
    },
    bodyStyles: {
      fontSize: 7.5,
      cellPadding: { top: 2.5, bottom: 2.5, left: 2.5, right: 2.5 },
      textColor: C.dark,
    },
    alternateRowStyles: {
      fillColor: [248, 246, 250],
    },
    columnStyles: {
      0: { halign: 'center', fontStyle: 'bold', cellWidth: 10, textColor: C.primary },
      1: { fontStyle: 'bold', cellWidth: 42 },
      2: { cellWidth: 42 },
      3: { halign: 'center', fontStyle: 'bold', cellWidth: 20, textColor: C.primary },
      4: { halign: 'center', fontStyle: 'bold', cellWidth: 16 },
      5: { halign: 'center', cellWidth: 18 },
      6: { halign: 'center', cellWidth: 14 },
      7: { halign: 'center', fontStyle: 'bold', cellWidth: 20 },
    },
    didParseCell: (data) => {
      if (data.section !== 'body') return
      // Efectividad (col 4)
      if (data.column.index === 4) {
        const val = parseInt(data.row.raw[4])
        if (!isNaN(val)) {
          data.cell.styles.textColor = val >= 80 ? C.success : val >= 60 ? C.warning : C.error
        }
      }
      // Mérito (col 7)
      if (data.column.index === 7) {
        if (data.row.index === 0) data.cell.styles.textColor = [180, 130, 20]
        else if (data.row.index === 1) data.cell.styles.textColor = [110, 110, 120]
        else if (data.row.index === 2) data.cell.styles.textColor = [160, 95, 40]
        else data.cell.styles.textColor = C.gray
      }
    }
  })

  cursorY = doc.lastAutoTable.finalY + 8

  // ── SECCIÓN 3: AUDITORÍA TÉCNICA Y FIRMAS ─────────────────────────────────
  // Si no entra el bloque de firmas (requiere unos 45mm), pasar a nueva página
  if (cursorY + 45 > PH - 20) {
    doc.addPage()
    cursorY = 20
  }

  // Caja de Auditoría y Juego Limpio
  roundedRect(doc, MARGIN, cursorY, CONTENT_W, 14, 2, [245, 248, 252])
  doc.setDrawColor(200, 220, 240)
  doc.setLineWidth(0.4)
  doc.roundedRect(MARGIN, cursorY, CONTENT_W, 14, 2, 2, 'D')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(30, 80, 140)
  doc.text('AUDITORÍA TÉCNICA Y CONTROL DE INTEGRIDAD DIGITAL:', MARGIN + 4, cursorY + 4.5)

  const disc = metricasGlobales.sociedadMasDisciplinada
  const alertRec = metricasGlobales.sociedadConMasAlertas
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.8)
  doc.setTextColor(...C.dark)
  const auditLine1 = `• Mención al Juego Limpio y Disciplina: ${disc ? `${disc.sociedad} (${disc.iglesia}) con ${disc.totalAlertas} alertas de seguridad registradas.` : 'Sin incidentes relevantes.'}`
  const auditLine2 = `• Supervisión de Plataforma: Todas las sesiones contaron con monitoreo de cambio de pestañas, bloqueo de copiado y registro de tiempos en milisegundos.`
  doc.text(auditLine1, MARGIN + 4, cursorY + 8.5)
  doc.text(auditLine2, MARGIN + 4, cursorY + 12)

  cursorY += 19

  // Párrafo de Certificación Oficial
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(6.8)
  doc.setTextColor(...C.gray)
  const certTexto = 'El presente informe ejecutivo certifica formalmente los resultados alcanzados en la 1ra Etapa de las Olimpiadas Bíblicas UJELADEA 2026. Los datos han sido auditados digitalmente y procesados con estricta sujeción al reglamento general.'
  const certLines = doc.splitTextToSize(certTexto, CONTENT_W)
  doc.text(certLines, MARGIN, cursorY)

  cursorY += certLines.length * 3.5 + 10

  // ── LÍNEAS DE FIRMA OFICIAL ───────────────────────────────────────────────
  const firmaW = (CONTENT_W - 16) / 3
  const firmas = [
    { cargo: 'Comisión Técnica y Evaluadora', institucion: 'UJELADEA 2026' },
    { cargo: 'Pastor Asesor', institucion: 'Acompañamiento Espiritual' },
    { cargo: 'Presidencia General', institucion: 'Directiva Central UJELADEA' }
  ]

  firmas.forEach((f, idx) => {
    const x = MARGIN + idx * (firmaW + 8)
    // Línea punteada/continua para firmar
    doc.setDrawColor(...C.gray)
    doc.setLineWidth(0.4)
    doc.line(x, cursorY, x + firmaW, cursorY)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(...C.dark)
    textCentered(doc, f.cargo, x, cursorY + 4, firmaW)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...C.gray)
    textCentered(doc, f.institucion, x, cursorY + 7.5, firmaW)
  })

  // ── NUMERACIÓN DE PÁGINAS Y PIE DE PÁGINA GLOBAL ──────────────────────────
  const totalPages = doc.internal.getNumberOfPages()
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i)
    doc.setFillColor(...C.lightGray)
    doc.rect(0, PH - 14, PW, 14, 'F')

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...C.gray)
    doc.text('OLIMPIADAS BÍBLICAS UJELADEA 2026 — Informe Oficial para la Directiva y Cuadro de Honor', MARGIN, PH - 6)
    doc.text(`Página ${i} de ${totalPages}`, PW - MARGIN, PH - 6, { align: 'right' })
  }

  // ── DESCARGA O APERTURA ───────────────────────────────────────────────────
  const blob = doc.output('blob')
  const url = URL.createObjectURL(blob)
  const win = window.open(url, '_blank')
  if (win) win.document.title = nombreArchivo
  else doc.save(nombreArchivo)
}

