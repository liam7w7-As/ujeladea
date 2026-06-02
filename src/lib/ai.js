export async function calificarRespuestaAbierta(
pregunta,
respuestaReferencia,
respuestaJoven
) {
const apiKey = import.meta.env.VITE_GROQ_API_KEY

if (!apiKey) {
return {
puntaje: 0,
justificacion: 'Falta configurar VITE_GROQ_API_KEY en el archivo .env',
es_correcta: false
}
}

const promptSistema = `
Eres un evaluador oficial del Torneo Bíblico de UJELADEA.

Tu tarea es calificar respuestas abiertas de participantes jóvenes utilizando como base la respuesta de referencia proporcionada por los organizadores y docentes del instituto teológico.

INSTRUCCIONES:

* Evalúa principalmente la exactitud bíblica.
* Usa la respuesta de referencia como criterio principal.
* No exijas que el participante escriba exactamente las mismas palabras.
* Acepta sinónimos, paráfrasis y explicaciones equivalentes.
* Ignora errores ortográficos o de redacción si el significado es claro.
* Considera correcta una respuesta que exprese adecuadamente la misma idea bíblica central.
* Si la respuesta es parcialmente correcta, asigna un puntaje proporcional.
* Si contradice claramente la respuesta de referencia o la enseñanza bíblica, asigna una puntuación baja o cero.
* No agregues doctrinas, interpretaciones o ideas que no estén presentes en la respuesta de referencia.
* Sé justo, consistente y objetivo.

ESCALA:

* 100% del puntaje: respuesta correcta y completa.
* 75% del puntaje: respuesta correcta pero incompleta.
* 50% del puntaje: respuesta parcialmente correcta.
* 25% del puntaje: contiene pocos elementos correctos.
* 0% del puntaje: incorrecta o sin relación con la pregunta.

El puntaje máximo permitido es ${pregunta.puntaje}.

Determina "es_correcta":

* true si obtiene al menos el 70% del puntaje máximo.
* false si obtiene menos del 70%.

Responde EXCLUSIVAMENTE con JSON válido.

{
"puntaje": numero,
"justificacion": "explicación breve en español",
"es_correcta": boolean
}
`

const promptUsuario = `
PREGUNTA:
${pregunta.texto}

RESPUESTA DE REFERENCIA:
${respuestaReferencia}

RESPUESTA DEL PARTICIPANTE:
${respuestaJoven}

Evalúa la respuesta.
`

try {
const response = await fetch(
'https://api.groq.com/openai/v1/chat/completions',
{
method: 'POST',
headers: {
Authorization: `Bearer ${apiKey}`,
'Content-Type': 'application/json'
},
body: JSON.stringify({
model: 'llama3-70b-8192',
messages: [
{
role: 'system',
content: promptSistema
},
{
role: 'user',
content: promptUsuario
}
],
temperature: 0.1,
max_tokens: 300,
response_format: {
type: 'json_object'
}
})
}
)

if (!response.ok) {
  throw new Error(`Error en API Groq: ${response.status}`)
}

const data = await response.json()
const content = data.choices[0].message.content

const resultado = JSON.parse(content)

const puntaje = Math.max(
  0,
  Math.min(
    pregunta.puntaje,
    Number(resultado.puntaje) || 0
  )
)

return {
  puntaje,
  justificacion:
    resultado.justificacion ||
    'Sin justificación proporcionada.',
  es_correcta:
    puntaje >= pregunta.puntaje * 0.7
}

} catch (error) {
console.error('Error al calificar con Groq:', error)

return {
  puntaje: 0,
  justificacion:
    'Error al procesar la evaluación automática: ' +
    error.message,
  es_correcta: false
}

}
}
