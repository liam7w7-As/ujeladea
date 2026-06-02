import { Navigate } from 'react-router-dom'
import { useExamen } from '../context/ExamenContext'

export default function RutaProtegida({ children }) {
  const { usuario, cargando } = useExamen()

  if (cargando) {
    return (
      <div className="page-wrapper">
        <div className="page-content" style={{ textAlign: 'center' }}>
          <div className="spinner" style={{ margin: '0 auto' }} />
          <p style={{
            marginTop: 'var(--space-md)',
            color: 'var(--color-text-muted)',
            fontSize: '0.85rem'
          }}>
            Verificando sesión…
          </p>
        </div>
      </div>
    )
  }

  if (!usuario || usuario.tipo !== 'admin') {
    return <Navigate to="/admin/login" replace />
  }

  return children
}
