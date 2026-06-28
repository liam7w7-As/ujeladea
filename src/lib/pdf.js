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
  const cols = ['#', 'Nombre del Joven', 'Del Censo', 'Puntaje Obtenido', 'Estado']
  const rows = participantes.map((p, idx) => [
    `${idx + 1}°`,
    p.nombre,
    p.del_censo ? 'Sí' : 'Invitado',
    `${p.puntaje_total ?? 0} pts`,
    p.pendientes > 0 ? `${p.pendientes} pend.` : '✓ Completo',
  ])

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
      0: { halign: 'center', fontStyle: 'bold', cellWidth: 12, textColor: C.primary },
      1: { fontStyle: 'bold', cellWidth: 70 },
      2: { halign: 'center', cellWidth: 24 },
      3: { halign: 'center', fontStyle: 'bold', cellWidth: 36 },
      4: { halign: 'center', cellWidth: 28 },
    },
    // Colorear la fila si hay pendientes
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 4) {
        const raw = data.row.raw[4]
        if (raw && raw.includes('pend.')) {
          data.cell.styles.textColor = C.warning
          data.cell.styles.fontStyle = 'bold'
        } else if (raw === '✓ Completo') {
          data.cell.styles.textColor = C.success
        }
      }
      // Colorear la posición (columna 0) top 3
      if (data.section === 'body' && data.column.index === 3) {
        data.cell.styles.textColor = C.primary
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
