// Cola por pregunta: escribe primero en el dispositivo y serializa los envíos al servidor.
export class BorradorExamen {
  constructor({ api, intento, pregunta, storage, onEstado, demora = 800, uuid = () => crypto.randomUUID() }) {
    this.api = api
    this.intento = intento
    this.pregunta = pregunta
    this.storage = storage
    this.onEstado = onEstado
    this.demora = demora
    this.uuid = uuid
    this.key = 'ujeladea_borrador_v2:' + intento + ':' + pregunta.id
    this.listeners = new Set()
    this.cola = Promise.resolve()
    this.activo = false
    this.revision = pregunta.revision
    this.remoto = pregunta.borrador || ''
    this.solicitud = null
    this.confirmacionPendiente = false
    let local
    try { local = JSON.parse(storage?.getItem(this.key) || 'null') } catch { local = null }
    const valido = local?.version === 2 && typeof local.texto === 'string' && local.texto.length <= 2000
    const texto = valido ? local.texto : this.remoto
    const conflicto = valido && local.revision !== this.revision && texto !== this.remoto
    this.solicitud = valido ? local.solicitud || null : null
    this.confirmacionPendiente = valido && Boolean(local.confirmar)
    this.snapshot = { texto, estado: conflicto ? 'conflicto' : this.confirmacionPendiente ? 'pendiente' : texto === this.remoto ? 'guardado' : 'local', localDisponible: true }
  }
  subscribe = listener => { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  getSnapshot = () => this.snapshot
  emitir(cambios) {
    this.snapshot = { ...this.snapshot, ...cambios }
    for (const listener of this.listeners) listener()
  }
  persistir() {
    try {
      if (!this.storage) throw new Error('Sin almacenamiento')
      this.storage.setItem(this.key, JSON.stringify({ version: 2, texto: this.snapshot.texto, revision: this.revision, solicitud: this.solicitud, confirmar: this.confirmacionPendiente }))
    } catch { this.emitir({ localDisponible: false }) }
  }
  iniciar() {
    this.activo = true
    if (this.snapshot.estado !== 'conflicto') this.timer = setTimeout(() => this.reintentar(), this.demora)
  }
  destruir() { this.activo = false; clearTimeout(this.timer); this.listeners.clear() }
  cambiar(texto) {
    if (['enviando','pendiente'].includes(this.snapshot.estado)) return
    this.emitir({ texto, estado: this.snapshot.estado === 'conflicto' ? 'conflicto' : 'local' })
    this.persistir()
    clearTimeout(this.timer)
    if (this.snapshot.estado !== 'conflicto') this.timer = setTimeout(() => this.guardar(), this.demora)
  }
  encolar(fn) {
    const promesa = this.cola.then(fn)
    this.cola = promesa.catch(() => {})
    return promesa
  }
  sincronizar(pregunta) {
    if (!pregunta || pregunta.id !== this.pregunta.id || pregunta.revision <= this.revision) return
    const habiaCambios = this.snapshot.texto !== this.remoto
    this.revision = pregunta.revision
    this.remoto = pregunta.borrador || ''
    if (this.confirmacionPendiente) {
      if (this.snapshot.texto !== this.remoto) this.emitir({ estado: 'conflicto' })
      return
    }
    if (!habiaCambios) this.emitir({ texto: this.remoto, estado: 'guardado' })
    else if (this.snapshot.texto === this.remoto) this.emitir({ estado: 'guardado' })
    else this.emitir({ estado: 'conflicto' })
  }
  async error(err) {
    if (err.code === '40001') {
      try {
        const estado = await this.api.estado(this.intento)
        if (this.activo) this.onEstado(estado)
        if (estado.pregunta?.id === this.pregunta.id && estado.pregunta.revision >= this.revision) {
          this.revision = estado.pregunta.revision
          this.remoto = estado.pregunta.borrador || ''
        }
      } catch { /* Se conserva el texto local para revisión. */ }
      this.emitir({ estado: 'conflicto' })
    } else this.emitir({ estado: 'error', mensaje: err.message })
  }
  guardar() {
    return this.encolar(async () => {
      if (this.snapshot.estado === 'conflicto' || this.snapshot.estado === 'enviando' || !this.activo) return
      const texto = this.snapshot.texto
      if (texto === this.remoto) { this.emitir({ estado: 'guardado' }); return }
      this.emitir({ estado: 'guardando' })
      try {
        const estado = await this.api.borrador(this.intento, this.pregunta.id, texto, this.revision)
        if (estado.pregunta?.id === this.pregunta.id && estado.pregunta.revision >= this.revision) {
          this.revision = estado.pregunta.revision
          this.remoto = estado.pregunta.borrador || ''
          this.emitir({ estado: this.confirmacionPendiente ? 'enviando' : this.snapshot.texto === texto ? 'guardado' : 'local' })
          this.persistir()
        }
        if (this.activo) this.onEstado(estado)
        if (this.activo && this.snapshot.texto !== this.remoto && estado.intento.estado === 'en_curso' && this.snapshot.estado !== 'conflicto') {
          clearTimeout(this.timer)
          this.timer = setTimeout(() => this.guardar(), this.demora)
        }
      } catch (err) { await this.error(err) }
    })
  }
  confirmar() {
    if (this.enviando || ['enviando','conflicto'].includes(this.snapshot.estado) || !this.snapshot.texto.trim()) return this.cola
    clearTimeout(this.timer)
    this.enviando = true
    this.solicitud ||= this.uuid()
    this.confirmacionPendiente = true
    this.emitir({ estado: 'enviando' })
    this.persistir()
    return this.encolar(async () => {
      if (this.snapshot.estado === 'conflicto') { this.enviando = false; return }
      this.emitir({ estado: 'enviando' })
      try {
        const estado = await this.api.responder(this.intento, this.pregunta.id, this.snapshot.texto, this.solicitud)
        this.confirmacionPendiente = false
        if (estado.intento.respondidas >= this.pregunta.posicion) {
          try { this.storage?.removeItem(this.key) } catch { /* La confirmación del servidor sigue siendo válida. */ }
        }
        if (this.activo) this.onEstado(estado)
        this.emitir({ estado: 'guardado' })
      } catch (err) { await this.error(err); if (this.snapshot.estado !== 'conflicto') this.emitir({ estado: 'pendiente' }) }
      finally { this.enviando = false }
    })
  }
  reintentar() {
    if (this.snapshot.estado === 'conflicto' || this.snapshot.estado === 'enviando') return
    return this.confirmacionPendiente ? this.confirmar() : this.guardar()
  }
  conservarLocal() { this.confirmacionPendiente = false; this.solicitud = null; this.emitir({ estado: 'local' }); this.persistir(); return this.guardar() }
  usarGuardado() { this.emitir({ texto: this.remoto, estado: 'guardado' }); this.confirmacionPendiente = false; this.solicitud = null; this.persistir() }
}
