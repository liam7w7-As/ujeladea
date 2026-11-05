import { useState } from 'react'
import { Check, PenLine, RotateCcw } from 'lucide-react'

// Ejercicio de interfaz: no consulta el banco ni crea intentos, respuestas o borradores.
export default function PracticaExamen() {
  const [opcion, setOpcion] = useState('')
  const [texto, setTexto] = useState('')
  const [paso, setPaso] = useState(0)
  return <details className="joven-practica">
    <summary><PenLine size={18} aria-hidden="true" /> Practicar antes de empezar</summary>
    <p className="joven-ayuda">Es una muestra de los controles. No tiene nota ni usa preguntas del examen. Si el encargado inicia la prueba, entrarás automáticamente.</p>
    {paso === 0 ? <><h3>Prueba seleccionar una opción</h3><p>Elige una de estas opciones de ejemplo.</p>
      <div className="joven-opciones">{['Ejemplo A', 'Ejemplo B'].map(v => <button type="button" key={v} aria-pressed={opcion === v} className={opcion === v ? 'seleccionada' : ''} onClick={() => setOpcion(v)}>{v}{opcion === v && <Check size={18} aria-hidden="true" />}</button>)}</div>
      <button type="button" className="btn btn-secondary" disabled={!opcion} onClick={() => setPaso(1)}>Confirmar ejemplo y continuar</button>
    </> : paso === 1 ? <><label className="form-label" htmlFor="practica-texto">Prueba escribir una respuesta</label><textarea id="practica-texto" className="form-input" rows={3} maxLength={2000} value={texto} onChange={e => setTexto(e.target.value)} placeholder="Escribe unas palabras de ejemplo" /><p className="joven-ayuda">En el examen real, comprueba el guardado y revisa tu texto. Cada confirmación es definitiva.</p><button type="button" className="btn btn-secondary" disabled={!texto.trim()} onClick={() => setPaso(2)}>Finalizar práctica</button></>
      : <div role="status"><h3>Ya conoces los controles</h3><p>Selecciona o escribe, revisa y confirma. El examen real sigue pendiente de inicio.</p><button type="button" className="btn btn-secondary" onClick={() => { setPaso(0); setOpcion(''); setTexto('') }}><RotateCcw size={16} aria-hidden="true" /> Repetir práctica</button></div>}
  </details>
}
