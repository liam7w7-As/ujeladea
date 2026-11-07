import { NOMBRES_SENALES } from '../lib/supervision-vista'
const etiquetas = { cambio_pestana: 'Examen oculto', salio_fullscreen: 'Salida de pantalla completa', desenfoque: 'Pérdida de foco', intento_copiar: 'Intento de copiar', intento_pegar: 'Pegado de texto', intento_clic_derecho: 'Menú contextual', devtools_detectado: 'Señal de herramientas del navegador' }
export default function AlertasParticipante({ participante, alertas, supervision = [] }) {
  const eventos = (alertas?.detalle || []).filter(e => e.tipo !== 'supervision_vista')
  const episodios = supervision.filter(e => e.participante_id === participante.id && e.senales.some(s => s !== 'pantalla_completa_no_disponible'))
  const total = eventos.reduce((n, e) => n + Number(e.cantidad || 0), 0) + episodios.length
  if (!total) return <p className="etapa-help">Sin alertas</p>
  return <div className={'alertas-participante' + (participante.requiere_aprobacion ? ' requieren-revision' : '')} role="status" aria-live="polite" aria-label={'Alertas de ' + participante.nombre}>
    <strong>Alertas: {total}{participante.requiere_aprobacion ? ' · Requiere revisión' : ''}</strong>
    <ul>{eventos.map(e => <li key={e.tipo}>{etiquetas[e.tipo] || e.tipo}: {e.cantidad}</li>)}{episodios.slice(0, 2).map(e => <li key={e.episodio}>{e.senales.filter(s => s !== 'pantalla_completa_no_disponible').map(s => NOMBRES_SENALES[s] || s).join(' · ')} · {Math.ceil(e.duracion_ms / 1000)} s{!e.hasta ? ' · En curso' : ''}</li>)}</ul>
  </div>
}
