// Son indicios del navegador, nunca una afirmación de fraude ni un acceso a otras apps.
export const NOMBRES_SENALES = {
  oculta: 'Examen oculto', sin_foco: 'Otra ventana recibió el foco',
  vista_reducida: 'Vista reducida; posible pantalla dividida o ventana flotante',
  salio_fullscreen: 'Salida de pantalla completa',
  pantalla_completa_no_disponible: 'Pantalla completa no disponible en este navegador',
}

export function vistaReducida(base, actual) {
  if (!base || !actual || actual.zoom !== 1 || base.orientacion !== actual.orientacion) return false
  if (actual.movil && actual.pantallaAncho > 0 && actual.ancho < actual.pantallaAncho * .72) return true
  if (actual.ancho < base.ancho * .72) return true
  // El teclado, los campos de texto y las barras del navegador no prueban multiventana.
  return !actual.editando && actual.alto < base.alto * .58 && actual.ancho >= base.ancho * .9
}

export class SupervisionVista {
  constructor({ reportar, advertir, intento, storage, ventana = globalThis.window, documento = globalThis.document, ahora = Date.now, uuid = () => crypto.randomUUID() }) {
    Object.assign(this, { reportar, advertir, ventana, documento, ahora, uuid })
    this.cambiar = () => this.comprobar()
    this.base = this.medidas()
    this.usoFullscreen = Boolean(documento.fullscreenElement)
    this.pendientes = new Map()
    this.storage = storage; this.key = 'ujeladea_supervision_v3:' + intento
    try { for (const e of JSON.parse(storage?.getItem(this.key) || '[]').slice(-100)) if (typeof e.episodio === 'string') this.pendientes.set(e.episodio, e) } catch { /* Se conserva la supervisión aunque falle la copia local. */ }
  }
  medidas() {
    const v = this.ventana, d = this.documento
    return { ancho: v.innerWidth, alto: v.innerHeight, orientacion: v.screen?.orientation?.angle ?? 0,
      zoom: v.visualViewport?.scale ?? 1, pantallaAncho: v.screen?.width || 0, movil: /Android|iPhone|iPad|Mobile/.test(v.navigator?.userAgent || ''), editando: Boolean(d.activeElement?.matches?.('input,textarea,select,[contenteditable="true"]')) }
  }
  iniciar() {
    this.activo = true
    for (const evento of ['focus', 'blur', 'resize', 'orientationchange']) this.ventana.addEventListener(evento, this.cambiar)
    for (const evento of ['visibilitychange', 'fullscreenchange', 'focusin', 'focusout']) this.documento.addEventListener(evento, this.cambiar)
    this.ventana.visualViewport?.addEventListener('resize', this.cambiar)
    this.timer = setInterval(() => this.comprobar(), 1000)
    if (!this.documento.fullscreenEnabled) this.informarPantalla()
    this.comprobar()
  }
  informarPantalla() {
    if (this.informada) return
    this.informada = true
    this.encolar({ episodio: this.uuid(), fase: 'fin', senales: ['pantalla_completa_no_disponible'], duracion: 0 })
  }
  comprobar() {
    if (!this.activo) return
    const medidas = this.medidas(), ahora = this.ahora(), d = this.documento
    if (medidas.orientacion !== this.base.orientacion || (d.fullscreenElement && !this.usoFullscreen)) {
      this.base = medidas
      this.adaptarHasta = ahora + 3000
    }
    if (d.fullscreenElement) this.usoFullscreen = true
    // Aprende el área útil máxima, sin tomar el teclado como nuevo tamaño de pantalla.
    if (!medidas.editando && medidas.zoom === 1 && medidas.orientacion === this.base.orientacion && (medidas.ancho > this.base.ancho || medidas.alto > this.base.alto)) {
      this.base = { ...medidas, ancho: Math.max(medidas.ancho, this.base.ancho), alto: Math.max(medidas.alto, this.base.alto) }
    }
    const senales = []
    if (d.hidden) senales.push('oculta')
    if (!d.hidden && !d.hasFocus()) senales.push('sin_foco')
    if (!d.hidden && ahora >= (this.adaptarHasta || 0) && vistaReducida(this.base, medidas)) senales.push('vista_reducida')
    if (!d.hidden && this.usoFullscreen && !d.fullscreenElement) senales.push('salio_fullscreen')
    if (!senales.length) {
      if (this.episodio?.enviado) this.cerrarEpisodio(ahora)
      this.episodio = null
      return
    }
    if (!this.episodio) this.episodio = { id: this.uuid(), desde: ahora, senales: new Set(), enviado: false, ultimo: 0, ausenciaMax: 0 }
    const e = this.episodio
    for (const s of senales) e.senales.add(s)
    const fuerte = senales.some(s => ['oculta', 'sin_foco', 'salio_fullscreen'].includes(s))
    if (fuerte && e.fuerteDesde == null) e.fuerteDesde = ahora
    if (!fuerte && e.fuerteDesde != null) { e.ausenciaMax = Math.max(e.ausenciaMax, ahora - e.fuerteDesde); e.fuerteDesde = null }
    const clave = senales.join(',')
    // Los cambios breves (p. ej., una notificación) no generan un incidente.
    if (ahora - e.desde < 2000 || (e.enviado && clave === e.clave && ahora - e.ultimo < 8000)) return
    const primera = !e.enviado
    e.enviado = true; e.ultimo = ahora; e.clave = clave
    this.encolar({ episodio: e.id, fase: primera ? 'inicio' : 'pulso', senales, observadas: [...e.senales], duracion: ahora - e.desde, ausencia: Math.max(e.ausenciaMax, e.fuerteDesde == null ? 0 : ahora - e.fuerteDesde) })
    if (primera) this.advertir?.(senales.includes('vista_reducida') ? 'vista_reducida' : 'sin_foco')
  }
  cerrarEpisodio(ahora) {
    const e = this.episodio
    this.encolar({ episodio: e.id, fase: 'fin', senales: [], observadas: [...e.senales], duracion: ahora - e.desde, ausencia: Math.max(e.ausenciaMax, e.fuerteDesde == null ? 0 : ahora - e.fuerteDesde) })
  }
  encolar(evento) {
    // Un solo envío pendiente por episodio: el cierre reemplaza los pulsos antiguos.
    this.pendientes.set(evento.episodio, evento)
    if (this.pendientes.size > 100) this.pendientes.delete(this.pendientes.keys().next().value)
    this.persistir()
    void this.enviar()
  }
  persistir() { try { this.storage?.setItem(this.key, JSON.stringify([...this.pendientes.values()])) } catch { /* El almacenamiento no bloquea respuestas. */ } }
  async enviar() {
    if (this.enviando || !this.reportar) return
    this.enviando = true
    try {
      for (const [id, evento] of this.pendientes) {
        try {
          await this.reportar(evento)
          if (this.pendientes.get(id) === evento) this.pendientes.delete(id)
          this.persistir()
        } catch { break }
      }
    } finally { this.enviando = false }
  }
  destruir() {
    this.activo = false
    if (this.episodio?.enviado) this.cerrarEpisodio(this.ahora())
    clearInterval(this.timer)
    for (const evento of ['focus', 'blur', 'resize', 'orientationchange']) this.ventana.removeEventListener(evento, this.cambiar)
    for (const evento of ['visibilitychange', 'fullscreenchange', 'focusin', 'focusout']) this.documento.removeEventListener(evento, this.cambiar)
    this.ventana.visualViewport?.removeEventListener('resize', this.cambiar)
  }
}
