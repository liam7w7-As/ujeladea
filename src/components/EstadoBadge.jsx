export default function EstadoBadge({ estado, size = 'md' }) {
  const getEstilos = () => {
    switch (estado) {
      case 'esperando':
        return { color: 'var(--color-warning)', border: '1px solid var(--color-warning)' }
      case 'activo':
        return { color: 'var(--color-info)', border: '1px solid var(--color-info)' }
      case 'finalizado':
        return { color: 'var(--color-success)', border: '1px solid var(--color-success)' }
      case 'excelente':
        return { color: '#ffd700', border: '1px solid rgba(255, 215, 0, 0.4)', background: 'rgba(255, 215, 0, 0.1)' }
      case 'bueno':
        return { color: 'var(--color-success)', border: '1px solid rgba(45, 138, 78, 0.4)', background: 'rgba(45, 138, 78, 0.1)' }
      case 'regular':
        return { color: 'var(--color-warning)', border: '1px solid rgba(212, 160, 23, 0.4)', background: 'rgba(212, 160, 23, 0.1)' }
      case 'pendiente_ia':
        return { color: '#8e44ad', border: '1px solid rgba(142, 68, 173, 0.4)', background: 'rgba(142, 68, 173, 0.1)' }
      default:
        return { color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }
    }
  }

  const getTexto = () => {
    switch (estado) {
      case 'esperando': return 'En espera'
      case 'activo': return 'En curso'
      case 'finalizado': return 'Finalizado'
      case 'excelente': return 'Excelente'
      case 'bueno': return 'Bueno'
      case 'regular': return 'Regular'
      case 'pendiente_ia': return 'Pendiente de Revisión'
      default: return estado
    }
  }

  const estilosSize = {
    sm: { padding: '2px 8px', fontSize: '0.7rem' },
    md: { padding: '4px 10px', fontSize: '0.8rem' },
    lg: { padding: '6px 14px', fontSize: '0.9rem' }
  }

  const animado = estado === 'activo' || estado === 'pendiente_ia'

  return (
    <span 
      style={{
        ...getEstilos(),
        ...estilosSize[size],
        borderRadius: '12px',
        fontWeight: 600,
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        whiteSpace: 'nowrap',
        boxShadow: animado ? `0 0 8px ${getEstilos().color}40` : 'none',
        transition: 'all 0.3s ease'
      }}
    >
      {animado && (
        <span 
          style={{ 
            width: '6px', height: '6px', borderRadius: '50%', background: getEstilos().color, 
            animation: 'pulse-opacity 1.5s infinite' 
          }} 
        />
      )}
      {getTexto()}
    </span>
  )
}
