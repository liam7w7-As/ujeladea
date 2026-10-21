import { Settings } from 'lucide-react'

export default function ConfiguracionPendiente() {
  return <main className="page-wrapper"><div className="page-content card">
    <Settings size={32} color="var(--color-accent)" />
    <h1 style={{ margin: '1rem 0', fontSize: '1.6rem' }}>Conecta tu entorno de pruebas</h1>
    <p>La aplicación necesita la URL y la clave pública de Supabase para iniciar.</p>
    <p style={{ marginTop: '1rem', color: 'var(--color-text-secondary)' }}>Copia .env.example a .env.local, completa los datos del entorno de pruebas y reinicia el servidor.</p>
  </div></main>
}
