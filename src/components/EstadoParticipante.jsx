export default function EstadoParticipante({ cargando, error, recargar }) {
  return <main className="page-wrapper"><section className="page-content card joven-estado">
    {cargando ? <><div className="spinner" /><p role="status">Recuperando tu examen…</p></> : <><h1>No pudimos conectar</h1><p role="alert">{error || 'Intenta de nuevo. Tu progreso confirmado se conserva.'}</p><button className="btn btn-primary" onClick={recargar}>Reintentar conexión</button></>}
  </section></main>
}
