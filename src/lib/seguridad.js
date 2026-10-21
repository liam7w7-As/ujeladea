// Señales de supervisión; no bloquean el guardado ni cambian la pregunta actual.
export class SeguridadExamen {
  constructor({ intento, reportar, onAdvertencia, storage = globalThis.localStorage }) {
    this.intento = intento
    this.reportar = reportar
    this.onAdvertencia = onAdvertencia
    this.storage = storage
    this.key = 'ujeladea_eventos_v2:' + intento
    this.ultimos = {}
    this.cola = []
    try {
      const guardados = JSON.parse(storage?.getItem(this.key) || '[]')
      if (Array.isArray(guardados)) this.cola = guardados.filter(e => typeof e.id === 'string' && typeof e.tipo === 'string').slice(-200)
    } catch { /* El registro sigue disponible sin caché local. */ }
    this.visibilidad = () => { if (document.hidden) this.registrar('cambio_pestana', true) }
    this.fullscreen = () => { if (!document.fullscreenElement) this.registrar('salio_fullscreen', true) }
    this.contexto = () => this.registrar('intento_clic_derecho')
    this.teclas = e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') this.registrar('intento_copiar') }
    this.pegar = () => this.registrar('intento_pegar')
    this.online = () => { void this.enviar() }
  }
  iniciar() {
    this.activo = true
    document.addEventListener('visibilitychange', this.visibilidad)
    document.addEventListener('fullscreenchange', this.fullscreen)
    document.addEventListener('contextmenu', this.contexto)
    document.addEventListener('paste', this.pegar)
    document.addEventListener('keydown', this.teclas)
    window.addEventListener('online', this.online)
    this.timer = setInterval(() => { void this.enviar() }, 3000)
  }
  persistir() { try { this.storage?.setItem(this.key, JSON.stringify(this.cola)) } catch { /* No interrumpe el examen. */ } }
  registrar(tipo, avisar = false) {
    if (!this.activo || Date.now() - (this.ultimos[tipo] || 0) < 5000) return
    this.ultimos[tipo] = Date.now()
    this.cola.push({ id: crypto.randomUUID(), tipo })
    this.cola = this.cola.slice(-200)
    this.persistir()
    if (avisar) this.onAdvertencia?.(tipo)
    void this.enviar()
  }
  async enviar() {
    if (this.enviando || !this.cola.length) return
    this.enviando = true
    const lote = this.cola.slice(0,20)
    try {
      await this.reportar(this.intento, lote)
      const ids = new Set(lote.map(e => e.id))
      this.cola = this.cola.filter(e => !ids.has(e.id))
      this.persistir()
    } catch { /* Reintento con los mismos identificadores; no se duplica el evento. */ }
    finally { this.enviando = false }
  }
  destruir() {
    this.activo = false
    clearInterval(this.timer)
    document.removeEventListener('visibilitychange', this.visibilidad)
    document.removeEventListener('fullscreenchange', this.fullscreen)
    document.removeEventListener('contextmenu', this.contexto)
    document.removeEventListener('paste', this.pegar)
    document.removeEventListener('keydown', this.teclas)
    window.removeEventListener('online', this.online)
    void this.enviar()
  }
}
