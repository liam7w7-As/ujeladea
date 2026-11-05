import { solicitarSugerencia } from './ai.js'

export const criteriosRevision = grupo => grupo?.rubrica?.length ? grupo.rubrica : [{ criterio: 'Puntaje conforme a la referencia', puntos: grupo?.maximo || 0 }]
export function validarPuntosRevision(puntos, grupo) {
  const criterios = criteriosRevision(grupo)
  return Array.isArray(puntos) && puntos.length === criterios.length && puntos.every((n, i) => Number.isInteger(n) && n >= 0 && n <= criterios[i].puntos)
}
export function instanciaRevision(storage, recarga = false) {
  const clave = 'ujeladea_jurado_instancia'
  let id
  try { if (recarga) id = storage?.getItem(clave) } catch { /* Puede estar restringido. */ }
  if (!/^[0-9a-f-]{36}$/i.test(id || '')) id = crypto.randomUUID()
  try { storage?.setItem(clave, id) } catch { /* La reserva del servidor sigue funcionando. */ }
  return id
}

// Serializa borradores, pulsos y confirmaciones. Un fallo nunca avanza a otra respuesta.
export class RevisionJurado {
  constructor({ client, sesion, etapa, actor, instancia, storage, onState = () => {} }) {
    Object.assign(this, { client, sesion, etapa, actor, instancia, storage, onState })
    this.clave = `ujeladea_jurado:${actor}:${etapa}:${sesion}`
    this.state = { resumen: null, grupo: '', modo: 'pendientes', item: null, puntos: [], comentario: '', motivo: '', sugerencia: null, error: '', ocupado: false, ia: false, borrador: '', commitPendiente: false, conflicto: false }
    this.cola = Promise.resolve()
    this.version = 0
    this.revisadas = new Set()
  }
  emitir(cambio) { if (!this.destruida) { this.state = { ...this.state, ...cambio }; this.onState(this.state) } }
  leer(clave) { try { return JSON.parse(this.storage?.getItem(clave) || 'null') } catch { return null } }
  escribir(clave, valor) {
    try { if (!this.storage) return false; this.storage.setItem(clave, JSON.stringify(valor)); return true } catch { return false }
  }
  borrar(clave) { try { this.storage?.removeItem(clave) } catch { /* El servidor conserva el estado confirmado. */ } }
  async rpc(nombre, args) {
    const { data, error } = await this.client.rpc(nombre, { p_sesion: this.sesion, p_etapa: this.etapa, ...args })
    if (error) {
      if (['40001', '55P03', '42501'].includes(error.code)) this.emitir({ conflicto: true })
      throw error
    }
    return data
  }
  encolar(fn) { const trabajo = this.cola.then(() => this.destruida ? undefined : fn()); this.cola = trabajo.catch(() => {}); return trabajo }
  async accion(fn) {
    if (this.state.ocupado || this.destruida) return false
    clearTimeout(this.timer)
    this.emitir({ ocupado: true, error: '' })
    try { await this.encolar(fn); return true } catch (e) { this.emitir({ error: e.message || 'No se pudo completar. Tus cambios se conservan.' }); return false }
    finally { this.emitir({ ocupado: false }) }
  }
  async resumen() { const resumen = await this.rpc('admin_revision_resumen', {}); this.emitir({ resumen }); return resumen }
  async confirmar(envio) {
    try { return await this.rpc('admin_revision_guardar', envio) } catch (error) {
      // SQLSTATE identifica una transacción rechazada. Un fallo de red deja el acuse incierto.
      if (/^[0-9A-Z]{5}$/.test(error.code || '')) {
        this.envio = null
        this.borrar(this.clave + ':envio')
        this.emitir({ commitPendiente: false })
      }
      throw error
    }
  }
  async iniciar() {
    return this.accion(async () => {
      // Repetir exactamente el envío pendiente resuelve un acuse perdido sin volver a calificar.
      const pendiente = this.leer(this.clave + ':envio')
      if (pendiente) {
        this.emitir({ commitPendiente: true })
        await this.confirmar(pendiente)
        this.envio = null
        this.borrar(this.clave + ':' + pendiente.p_respuesta + ':' + pendiente.p_revision)
        this.borrar(this.clave + ':envio')
        this.emitir({ commitPendiente: false })
      }
      const r = await this.resumen(), seleccion = this.leer(this.clave + ':seleccion')
      const grupo = r.preguntas.find(g => g.clave === seleccion?.grupo)?.clave || r.preguntas.find(g => g.pendientes > g.consultas)?.clave || r.preguntas[0]?.clave || ''
      this.emitir({ grupo, modo: seleccion?.modo || 'pendientes' })
      await this.siguiente()
    })
  }
  grupoActual() { return this.state.resumen?.preguntas.find(g => g.clave === this.state.grupo) }
  async siguiente() {
    const { grupo, modo } = this.state
    if (!grupo) return
    const item = await this.rpc('admin_revision_siguiente', { p_grupo: grupo, p_modo: modo, p_instancia: this.instancia, p_excluir: modo === 'revisadas' ? [...this.revisadas] : [] })
    if (this.destruida) return
    const clave = item && this.clave + ':' + item.id + ':' + item.revision
    const local = clave && this.leer(clave)
    const draft = local || item?.borrador
    const criterios = criteriosRevision(this.grupoActual())
    const puntos = Array.isArray(draft?.puntos) && draft.puntos.length === criterios.length ? draft.puntos : criterios.map(() => null)
    this.version++
    this.emitir({ item, puntos, comentario: draft?.comentario || '', motivo: draft?.motivo ?? item?.motivo_consulta ?? '', sugerencia: null, commitPendiente: false, conflicto: false, borrador: draft ? 'Borrador recuperado' : '', error: '' })
    if (item && local) this.programar()
  }
  parametros() {
    const { item, puntos, comentario } = this.state
    return { p_respuesta: item.id, p_instancia: this.instancia, p_revision: item.revision, p_puntos: puntos, p_comentario: comentario }
  }
  persistir() {
    if (!this.state.item) return true
    return this.escribir(this.clave + ':' + this.state.item.id + ':' + this.state.item.revision, { puntos: this.state.puntos, comentario: this.state.comentario, motivo: this.state.motivo })
  }
  editar(cambio) {
    if (!this.state.item || this.state.ocupado || this.state.commitPendiente || this.state.conflicto) return
    this.version++
    this.emitir(cambio)
    const local = this.persistir()
    this.emitir({ borrador: local ? 'Borrador en este dispositivo' : 'Guardando borrador en el servidor…' })
    this.programar()
  }
  programar() {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      void this.encolar(() => this.flush()).catch(e => this.emitir({ borrador: 'Borrador sin sincronizar', error: e.message }))
    }, 700)
  }
  async flush(accion = 'guardar') {
    if (!this.state.item) return
    const version = this.version
    const parametros = this.parametros()
    await this.rpc('admin_revision_borrador', { ...parametros, p_accion: accion, p_motivo: this.state.motivo })
    if (accion !== 'pulso' && version === this.version) this.emitir({ borrador: 'Borrador guardado' })
  }
  cambiar(grupo, modo) {
    if (this.state.commitPendiente || this.state.conflicto) return Promise.resolve(false)
    return this.accion(async () => {
      await this.flush('liberar')
      this.emitir({ grupo, modo, item: null })
      this.escribir(this.clave + ':seleccion', { grupo, modo })
      await this.resumen()
      await this.siguiente()
    })
  }
  guardar() {
    if (!this.state.item || this.state.conflicto) return Promise.resolve(false)
    if (!this.state.commitPendiente && !validarPuntosRevision(this.state.puntos, this.grupoActual())) {
      this.emitir({ error: 'Marca todos los criterios antes de guardar. Los criterios vacíos no cuentan como cero.' })
      return Promise.resolve(false)
    }
    return this.accion(async () => {
      const anterior = this.state.item
      let envio = this.leer(this.clave + ':envio')
      if (!envio) {
        envio = { ...this.parametros(), p_solicitud: crypto.randomUUID() }
        this.escribir(this.clave + ':envio', envio)
      }
      // También conservado en memoria si el almacenamiento está bloqueado.
      this.envio = this.envio || envio
      this.emitir({ commitPendiente: true })
      await this.confirmar(this.envio)
      if (this.state.modo === 'revisadas') this.revisadas.add(anterior.id)
      this.envio = null
      this.borrar(this.clave + ':envio')
      this.borrar(this.clave + ':' + anterior.id + ':' + anterior.revision)
      this.emitir({ item: null, commitPendiente: false })
      await this.resumen()
      await this.siguiente()
    })
  }
  consultar() {
    if (!this.state.item || !this.state.item.pendiente || this.state.commitPendiente || this.state.conflicto) return Promise.resolve(false)
    return this.accion(async () => {
      await this.flush('consulta')
      this.emitir({ item: null })
      await this.resumen()
      await this.siguiente()
    })
  }
  pulso() {
    if (!this.state.item || this.state.ocupado || this.state.commitPendiente || this.state.conflicto) return Promise.resolve()
    return this.encolar(() => this.flush('pulso')).catch(e => this.emitir({ error: e.message }))
  }
  async sugerir() {
    const item = this.state.item
    if (!item || !item.pendiente || this.state.ia || this.state.ocupado) return
    this.emitir({ ia: true, error: '' })
    try {
      const propuesta = await solicitarSugerencia(this.client, item.id)
      if (this.state.item?.id === item.id && this.state.item?.revision === item.revision) {
        if (propuesta.respuesta_id !== item.id || propuesta.revision !== item.revision || !validarPuntosRevision(propuesta.criterios?.map(c => c.puntos), this.grupoActual())) throw Error('La propuesta no corresponde a esta revisión.')
        this.emitir({ sugerencia: propuesta })
      }
    } catch (e) { if (this.state.item?.id === item.id) this.emitir({ error: e.message }) }
    finally { this.emitir({ ia: false }) }
  }
  aplicarSugerencia() {
    const s = this.state.sugerencia
    if (s) this.editar({ puntos: s.criterios.map(c => c.puntos) })
  }
  async salir() { return this.accion(() => { if (this.state.conflicto) this.persistir(); else return this.flush('liberar') }) }
  destruir() { this.persistir(); this.destruida = true; clearTimeout(this.timer) }
}
