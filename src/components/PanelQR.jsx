import { useRef, useState } from 'react'
import { QRCodeCanvas, QRCodeSVG } from 'qrcode.react'

export default function PanelQR({ value, archivo = 'QR_sesion.png', children }) {
  const canvas = useRef(null)
  const [mensaje, setMensaje] = useState('')
  async function copiar() {
    try {
      if (!navigator.clipboard) throw Error('Portapapeles no disponible')
      await navigator.clipboard.writeText(value)
      setMensaje('Enlace copiado.')
    } catch { setMensaje('Mantén pulsado el enlace para copiarlo.') }
  }
  function descargar() {
    try {
      const c = canvas.current, ctx = c?.getContext('2d')
      if (!ctx) throw Error('No se pudo preparar la imagen')
      const pixeles = ctx.getImageData(0, 0, c.width, c.height).data
      let contieneCodigo = false
      for (let i = 0; i < pixeles.length; i += 16) {
        if (pixeles[i] < 32 && pixeles[i + 1] < 32 && pixeles[i + 2] < 32 && pixeles[i + 3] > 240) { contieneCodigo = true; break }
      }
      if (!contieneCodigo) throw Error('La imagen aún no está lista')
      const enlace = document.createElement('a')
      enlace.href = c.toDataURL('image/png'); enlace.download = archivo
      document.body.append(enlace); enlace.click(); enlace.remove()
      setMensaje('QR descargado como imagen.')
    } catch { setMensaje('No se pudo descargar el QR. Puedes copiar el enlace directo.') }
  }
  return <div className="qr-panel">
    <QRCodeSVG value={value} size={240} level="M" marginSize={4} bgColor="#FFFFFF" fgColor="#000000" title="Código QR de acceso"/>
    <QRCodeCanvas ref={canvas} value={value} size={480} level="M" marginSize={4} bgColor="#FFFFFF" fgColor="#000000" style={{ display: 'none' }} aria-hidden="true"/>
    <a href={value} className="qr-enlace">{value}</a>
    {children}
    <div className="etapa-actions"><button type="button" className="btn btn-secondary" onClick={copiar}>Copiar enlace</button><button type="button" className="btn btn-secondary" onClick={descargar}>Descargar QR</button></div>
    {mensaje && <p role="status">{mensaje}</p>}
  </div>
}
