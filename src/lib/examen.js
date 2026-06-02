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
 * @param {Object} pregunta Objeto de la pregunta original
 * @param {string} respuestaDada Respuesta seleccionada/escrita por el usuario
 * @returns {Object} { es_correcta: boolean|null, puntaje_obtenido: number }
 */
export function calcularPuntajeAutomatico(pregunta, respuestaDada) {
  if (pregunta.tipo === 'multiple') {
    const esCorrecta = 
      respuestaDada.trim().toLowerCase() === 
      pregunta.respuesta_correcta.trim().toLowerCase();
    
    return {
      es_correcta: esCorrecta,
      puntaje_obtenido: esCorrecta ? pregunta.puntaje : 0,
      calificado_por: 'sistema'
    };
  }

  // Para preguntas abiertas o de contexto, se requiere calificación manual/IA
  return {
    es_correcta: null,
    puntaje_obtenido: null,
    calificado_por: 'pendiente_ia'
  };
}
