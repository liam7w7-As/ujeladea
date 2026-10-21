export function crearApiExamen(client) {
  let autenticando
  async function identidad() {
    if (!autenticando) autenticando = (async () => {
      const { data, error } = await client.auth.getSession()
      if (error) throw error
      if (data.session) return data.session.user.id
      const registro = await client.auth.signInAnonymously()
      if (registro.error) throw registro.error
      return registro.data.user.id
    })().finally(() => { autenticando = null })
    return autenticando
  }
  async function llamar(nombre, args) {
    try { await identidad() }
    catch { throw new Error('No pudimos preparar tu acceso. Reintenta o avisa al encargado.') }
    const { data, error } = await client.rpc(nombre, args)
    if (error) {
      const err = new Error(['PGRST202','42883'].includes(error.code)
        ? 'El acceso al examen todavía no está preparado. Avisa al encargado.'
        : error.message || 'No se pudo conectar. Tu progreso confirmado se conserva.')
      err.code = error.code
      throw err
    }
    return data
  }
  return {
    contacto: (intento, accion = 'pulso', visible = true, motivo = '') => llamar('examen_contacto', { p_intento: intento, p_accion: accion, p_visible: visible, p_motivo: motivo }),
    sala: sesion => llamar('examen_sala', { p_sesion: sesion }),
    registrar: (sesion, participante) => llamar('examen_registrar', { p_sesion: sesion, p_participante: participante }),
    estado: intento => llamar('examen_estado', { p_intento: intento }),
    borrador: (intento, pregunta, texto, revision) => llamar('examen_borrador', { p_intento: intento, p_pregunta: pregunta, p_texto: texto, p_revision: revision }),
    responder: (intento, pregunta, texto, solicitud) => llamar('examen_responder', { p_intento: intento, p_pregunta: pregunta, p_texto: texto, p_solicitud: solicitud }),
    finalizar: intento => llamar('examen_finalizar', { p_intento: intento }),
    eventos: (intento, eventos) => llamar('examen_eventos', { p_intento: intento, p_eventos: eventos }),
    recuperar: (sesion, codigo) => llamar('examen_recuperar', { p_sesion: sesion, p_codigo: codigo }),
  }
}
