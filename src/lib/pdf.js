import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

// Función auxiliar para convertir logo a base64 circular
function getCircularBase64ImageFromUrl(imageUrl) {
  return new Promise((resolve) => {
    const img = new Image()
    img.setAttribute('crossOrigin', 'anonymous')
    img.onload = () => {
      const canvas = document.createElement("canvas")
      const size = Math.min(img.width, img.height)
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext("2d")
      
      // Crear máscara circular
      ctx.beginPath()
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2, true)
      ctx.closePath()
      ctx.clip()
      
      // Dibujar imagen centrada y recortada
      const srcX = (img.width - size) / 2
      const srcY = (img.height - size) / 2
      ctx.drawImage(img, srcX, srcY, size, size, 0, 0, size, size)
      
      // Agregar un borde sutil al canvas
      ctx.beginPath()
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2, true)
      ctx.lineWidth = size * 0.04
      ctx.strokeStyle = '#8f1937' // Borde color primario
      ctx.stroke()

      const dataURL = canvas.toDataURL("image/png")
      resolve(dataURL)
    }
    img.onerror = () => {
      resolve(null)
    }
    img.src = imageUrl
  })
}

export const generarReportePDF = async ({ titulo, subtitulo, columnas, filas, nombreArchivo }) => {
  const doc = new jsPDF()
  
  // Agregar logo circular
  try {
    const imgData = await getCircularBase64ImageFromUrl('/logo.png')
    if (imgData) {
      doc.addImage(imgData, 'PNG', 14, 12, 16, 16) // Más pequeño y compacto
    }
  } catch (error) {
    console.warn("No se pudo cargar el logo para el PDF", error)
  }

  // Título y Membrete (Más elegantes y pegados)
  doc.setFontSize(14)
  doc.setTextColor(143, 25, 55)
  doc.setFont('helvetica', 'bold')
  doc.text('TORNEO BÍBLICO UJELADEA', 35, 18)
  
  doc.setFontSize(11)
  doc.setTextColor(50, 50, 50)
  doc.setFont('helvetica', 'normal')
  doc.text(titulo, 35, 24)
  
  if (subtitulo) {
    doc.setFontSize(8.5)
    doc.setTextColor(100, 100, 100)
    // Dividir texto largo en múltiples líneas si es necesario
    const splitSub = doc.splitTextToSize(subtitulo, 160)
    doc.text(splitSub, 35, 29)
  }

  // Fecha generada (Arriba a la derecha para ahorrar espacio vertical)
  doc.setFontSize(8)
  const fechaStr = new Date().toLocaleString('es-ES', { 
    year: 'numeric', month: 'long', day: 'numeric', 
    hour: '2-digit', minute: '2-digit' 
  })
  doc.text(`Generado: ${fechaStr}`, 145, 18)

  // Tabla usando autoTable (Diseño mucho más compacto y elegante)
  autoTable(doc, {
    startY: 38, // Más arriba
    head: [columnas],
    body: filas,
    theme: 'grid',
    headStyles: { 
      fillColor: [143, 25, 55], 
      textColor: 255,
      fontStyle: 'bold',
      fontSize: 8,
      cellPadding: 4,
      halign: 'center' // Centrar cabeceras
    },
    bodyStyles: { 
      fontSize: 8, // Letra más pequeña
      cellPadding: 3, // Celdas más compactas
      font: 'helvetica',
      textColor: [40, 40, 40]
    },
    alternateRowStyles: { 
      fillColor: [250, 248, 249] // Tono casi blanco
    },
    columnStyles: {
      0: { fontStyle: 'bold', halign: 'center' } // Columna ID o Posición en negrita y centrada
    },
    didDrawPage: function (data) {
      // Pie de página con numeración
      let str = 'Página ' + doc.internal.getNumberOfPages()
      doc.setFontSize(8)
      doc.setTextColor(150)
      const pageSize = doc.internal.pageSize
      const pageHeight = pageSize.height ? pageSize.height : pageSize.getHeight()
      doc.text(str, data.settings.margin.left, pageHeight - 10)
    }
  })

  // En lugar de descargar, generar un Blob URL para abrir en una pestaña nueva (Estilo "I" de TCPDF)
  const pdfBlob = doc.output('blob')
  const pdfUrl = URL.createObjectURL(pdfBlob)
  
  // Abrir en nueva ventana (y opcionalmente le asigna un nombre si la ventana lo permite)
  const newWindow = window.open(pdfUrl, '_blank')
  if (newWindow) {
    newWindow.document.title = nombreArchivo || 'Reporte'
  } else {
    // Si el navegador bloquea las ventanas emergentes (popups), descargarlo por defecto
    doc.save(nombreArchivo || 'reporte.pdf')
  }
}
