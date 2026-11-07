import { BookOpen, CheckCircle2, Cloud, Clock, LifeBuoy } from 'lucide-react'

const pasos = [
  { icono: CheckCircle2, titulo: 'Confirma para avanzar', texto: 'Lee cada pregunta y revisa tu respuesta. Al confirmar queda registrada y ya no podrás cambiarla. La última confirmación finaliza el examen.' },
  { icono: Cloud, titulo: 'Comprueba el guardado', texto: 'El borrador se intenta guardar mientras escribes. Espera la confirmación del servidor antes de salir. Si pierdes conexión, conserva esta pantalla y reintenta cuando vuelva la red.' },
  { icono: Clock, titulo: 'El tiempo sigue corriendo', texto: 'Recargar la página o cambiar de dispositivo no reinicia el reloj. Al vencer se conserva el último borrador que el servidor recibió a tiempo.' },
  { icono: LifeBuoy, titulo: 'Pide ayuda si la necesitas', texto: 'Una alerta no borra tu progreso. Si cambias de dispositivo, pide al encargado un código de recuperación. Evita responder en varias pestañas a la vez.' },
]

export default function InstruccionesExamen({ total, etapa, minutos, compacto = false }) {
  const distribucion = etapa?.distribucion
  const cantidad = total || etapa?.cantidad_preguntas
  return <section className={'joven-instrucciones' + (compacto ? ' compactas' : '')} aria-label="Instrucciones del examen">
    <div className="joven-instrucciones-titulo"><BookOpen size={20} aria-hidden="true" /><h2>{compacto ? 'Cómo responder' : 'Antes de comenzar'}</h2>{Number.isInteger(cantidad) && cantidad > 0 && <span>{cantidad} preguntas</span>}</div>
    {!compacto && <div className="joven-formato">
      {distribucion && <p><strong>{distribucion.multiple}</strong> de selección · <strong>{distribucion.abierta}</strong> de respuesta · <strong>{distribucion.contexto}</strong> de contexto</p>}
      {Number.isFinite(minutos) && minutos > 0 && <p>Duración de la sala: <strong>{minutos} minutos</strong>, desde el inicio que marque el encargado.</p>}
      <p>Las preguntas aparecerán en un orden propio para cada participante.</p>
    </div>}
    <ol>{pasos.map(({ icono: Icono, titulo, texto }) => <li key={titulo}><Icono size={20} aria-hidden="true" /><div><h3>{titulo}</h3><p>{texto}</p></div></li>)}</ol>
    <p className="joven-instrucciones-nota">El encargado inicia el examen para toda la sala. Usa el examen como única vista de trabajo. Evita otras aplicaciones, ventanas flotantes o pantalla dividida. Si tu navegador no admite pantalla completa o surge una interrupción, avisa al moderador.</p>
  </section>
}
