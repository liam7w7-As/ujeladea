export default function EstadoParticipante({ cargando, error, recargar, mensajeCarga = 'Recuperando tu examen…' }) {
  return <main className="page-wrapper"><section className="page-content card joven-estado">
    {cargando ? <><div className="spinner" aria-hidden="true" /><p role="status">{mensajeCarga}</p></> : <><h1>No pudimos abrir esta pantalla</h1><p role="alert">{error || 'Intenta de nuevo. Tu progreso confirmado se conserva.'}</p><p className="joven-ayuda">Conserva este enlace. Si el problema continúa, avisa al moderador antes de cambiar de dispositivo.</p><button className="btn btn-primary" onClick={recargar}>Reintentar conexión</button></>}
  </section></main>
}
