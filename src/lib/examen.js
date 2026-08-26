/**
 * Generador de números pseudoaleatorios basado en una semilla (Linear Congruential Generator)
 */
function randomWithSeed(seed) {
  let s = seed;
  return function() {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

/**
 * Mezcla un array utilizando Fisher-Yates de forma determinística según la semilla
 * @param {Array} array El array a mezclar
 * @param {number} seed Semilla numérica única del participante
 * @returns {Array} Un nuevo array mezclado
 */
export function shuffleWithSeed(array, seed) {
  const result = [...array];
  const rng = randomWithSeed(seed);
  
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  
  return result;
}

/**
 * Toma el banco completo de preguntas y devuelve el subconjunto aleatorio para un joven
 * @param {Array} todasLasPreguntas Todas las preguntas con activa=true
 * @param {number} seed Semilla del joven
 * @param {number} cantidad Cantidad de preguntas que se deben devolver
 * @returns {Array} Subconjunto de preguntas mezcladas
 */
export function generarExamen(todasLasPreguntas, seed, cantidad) {
  const mezcladas = shuffleWithSeed(todasLasPreguntas, seed);
  return mezcladas.slice(0, cantidad);
}

/**
 * Evalúa una respuesta automáticamente
 * @param {Object} pregunta Objeto de la pregunta original (con opciones y respuesta_correcta)
 * @param {string} respuestaDada Respuesta seleccionada/escrita por el usuario
 * @returns {Object} { es_correcta: boolean|null, puntaje_obtenido: number, calificado_por: string }
 */
export function calcularPuntajeAutomatico(pregunta, respuestaDada) {
  if (pregunta.tipo === 'multiple') {
    const respUsuario = (respuestaDada || '').trim()
    const refCorrecta = (pregunta.respuesta_correcta || '').trim()

    // 1. Coincidencia directa exacta (ignorando mayúsculas/minúsculas)
    if (respUsuario.toLowerCase() === refCorrecta.toLowerCase()) {
      return {
        es_correcta: true,
        puntaje_obtenido: pregunta.puntaje,
        calificado_por: 'sistema'
      }
    }

    // 2. Extraer lista de opciones de la pregunta
    let opciones = []
    if (pregunta.opciones) {
      try {
        let rawOps = typeof pregunta.opciones === 'string' ? JSON.parse(pregunta.opciones) : pregunta.opciones
        if (Array.isArray(rawOps)) {
          opciones = rawOps.map(op => (typeof op === 'object' && op !== null ? (op.texto || '') : String(op)).trim())
        }
      } catch (e) {
        opciones = []
      }
    }

    // 3. Caso: La respuesta_correcta guardada es una letra ("A", "B", "C", "D", "A)", "B.", etc.)
    //    y el usuario marcó el texto de la opción (ej: "Palabra de exhortación")
    const letterRefMatch = refCorrecta.match(/^([A-Za-z])[\)\.\:\-]?$/)
    if (letterRefMatch && opciones.length > 0) {
      const letra = letterRefMatch[1].toUpperCase()
      const indiceLetra = letra.charCodeAt(0) - 65 // A=0, B=1, C=2, D=3...
      if (indiceLetra >= 0 && indiceLetra < opciones.length) {
        const textoOpcionCorrecta = opciones[indiceLetra]
        if (respUsuario.toLowerCase() === textoOpcionCorrecta.toLowerCase()) {
          return {
            es_correcta: true,
            puntaje_obtenido: pregunta.puntaje,
            calificado_por: 'sistema'
          }
        }
      }
    }

    // 4. Caso inverso: La respuesta del usuario es una letra y la respuesta_correcta es el texto
    const letterUserMatch = respUsuario.match(/^([A-Za-z])[\)\.\:\-]?$/)
    if (letterUserMatch && opciones.length > 0) {
      const letra = letterUserMatch[1].toUpperCase()
      const indiceLetra = letra.charCodeAt(0) - 65
      if (indiceLetra >= 0 && indiceLetra < opciones.length) {
        const textoOpcionElegida = opciones[indiceLetra]
        if (textoOpcionElegida.toLowerCase() === refCorrecta.toLowerCase()) {
          return {
            es_correcta: true,
            puntaje_obtenido: pregunta.puntaje,
            calificado_por: 'sistema'
          }
        }
      }
    }

    // 5. Comparar índices si tanto ref como respuesta tienen incisos (ej: "B) Palabra de..." vs "Palabra de...")
    for (let i = 0; i < opciones.length; i++) {
      const letraOpc = String.fromCharCode(65 + i)
      const textoOpc = opciones[i]
      const esOpcionCorrecta = 
        refCorrecta.toLowerCase() === textoOpc.toLowerCase() ||
        refCorrecta.toUpperCase() === letraOpc ||
        refCorrecta.toLowerCase().startsWith(`${letraOpc.toLowerCase()})`)

      const esOpcionMarcada = 
        respUsuario.toLowerCase() === textoOpc.toLowerCase() ||
        respUsuario.toUpperCase() === letraOpc ||
        respUsuario.toLowerCase().startsWith(`${letraOpc.toLowerCase()})`)

      if (esOpcionCorrecta && esOpcionMarcada) {
        return {
          es_correcta: true,
          puntaje_obtenido: pregunta.puntaje,
          calificado_por: 'sistema'
        }
      }
    }

    return {
      es_correcta: false,
      puntaje_obtenido: 0,
      calificado_por: 'sistema'
    }
  }

  // Para preguntas abiertas o de contexto, se requiere calificación manual/IA
  return {
    es_correcta: null,
    puntaje_obtenido: null,
    calificado_por: 'pendiente_ia'
  }
}
