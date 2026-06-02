export async function calificarRespuestaAbierta(pregunta, respuestaReferencia, respuestaJoven) {
  const apiKey = import.meta.env.VITE_GROQ_API_KEY

  if (!apiKey) {
    return {
      puntaje: 0,
      justificacion: 'Falta configurar VITE_GROQ_API_KEY en el archivo .env',
      es_correcta: false
    }
  }

  const promptSistema = `
Eres un evaluador de torneos bíblicos de la Iglesia de los Amigos (Quakers) en Bolivia.
Evalúa si la respuesta del participante es correcta basándote en la respuesta de referencia.
El puntaje máximo posible es ${pregunta.puntaje}.
Responde ÚNICAMENTE con un objeto JSON válido, sin usar bloques de código markdown, con la siguiente estructura:
{
  "puntaje": número entre 0 y ${pregunta.puntaje},
  "justificacion": "texto breve en español explicando la razón del puntaje",
  "es_correcta": boolean
}
`

  const promptUsuario = `
Pregunta: ${pregunta.texto}
Respuesta de referencia: ${respuestaReferencia}
Respuesta del participante: ${respuestaJoven}
`

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        messages: [
          { role: 'system', content: promptSistema },
          { role: 'user', content: promptUsuario }
        ],
        temperature: 0.2, // Baja temperatura para mayor precisión
        max_tokens: 500,
        response_format: { type: 'json_object' } // Groq soporta json_object
      })
    })

    if (!response.ok) {
      throw new Error(`Error en API Groq: ${response.status}`)
    }

    const data = await response.json()
    const content = data.choices[0].message.content
    const resultado = JSON.parse(content)

    return {
      puntaje: Number(resultado.puntaje) || 0,
      justificacion: resultado.justificacion || 'Sin justificación provista.',
      es_correcta: Boolean(resultado.es_correcta)
    }

  } catch (error) {
    console.error('Error al calificar con Groq:', error)
    return {
      puntaje: 0,
      justificacion: 'Error de conexión o fallo al procesar la IA. ' + error.message,
      es_correcta: false
    }
  }
}
