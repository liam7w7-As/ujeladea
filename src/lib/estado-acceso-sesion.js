export function estadoAccesoSesion(sala) {
  if (sala.disponible) return { titulo: 'Selecciona tu nombre', mensaje: 'Comprueba tu nombre antes de confirmar. Tu progreso quedará vinculado a este dispositivo.', esperar: false }
  const motivo = sala.motivo_no_disponible || (sala.etapa?.estado === 'borrador' ? 'etapa_en_preparacion' : sala.sesion?.estado === 'finalizado' ? 'sesion_finalizada' : '')
  if (motivo === 'etapa_en_preparacion') return { titulo: 'El encargado está preparando la evaluación', mensaje: 'La sesión existe, pero el registro todavía no está habilitado. Esta pantalla se actualizará cuando el encargado abra el acceso.', esperar: true }
  if (motivo === 'etapa_cerrada') return { titulo: 'La evaluación está cerrada', mensaje: 'El registro para esta etapa ha finalizado. Consulta con el encargado si necesitas ayuda.', esperar: false }
  if (motivo === 'sesion_finalizada' || motivo === 'tiempo_finalizado') return { titulo: 'Esta sesión ha finalizado', mensaje: 'Ya terminó el plazo para ingresar a esta sesión. Consulta con el encargado si necesitas ayuda.', esperar: false }
  return { titulo: 'El registro aún no está disponible', mensaje: 'El encargado te indicará cuándo puedes entrar. Puedes comprobar el acceso desde esta pantalla.', esperar: true }
}
