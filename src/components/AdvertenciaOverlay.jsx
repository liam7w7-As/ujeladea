import { AlertTriangle, Maximize } from 'lucide-react'

export default function AdvertenciaOverlay({ isOpen, onContinuar }) {
  if (!isOpen) return null

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.85)',
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'white',
      padding: 'var(--space-lg)',
      textAlign: 'center',
      backdropFilter: 'blur(8px)',
      animation: 'fadeIn 0.3s ease-out'
    }}>
      <div className="card fade-in" style={{ 
        maxWidth: '450px', 
        width: '100%', 
        background: 'var(--color-bg-base)', 
        color: 'var(--color-text-primary)',
        border: '2px solid var(--color-error)',
        boxShadow: '0 10px 40px rgba(231, 76, 60, 0.2)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 'var(--space-md)' }}>
          <div style={{ background: 'rgba(231, 76, 60, 0.1)', padding: '16px', borderRadius: '50%' }}>
            <AlertTriangle size={48} color="var(--color-error)" />
          </div>
        </div>
        
        <h2 style={{ fontSize: '1.5rem', marginBottom: 'var(--space-sm)' }}>Saliste de la pantalla</h2>
        <p style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-lg)' }}>
          Este evento ha sido registrado y notificado al jurado. 
          Debes mantener la evaluación en pantalla completa. Presiona el botón para continuar.
        </p>

        <button 
          onClick={onContinuar} 
          className="btn btn-primary" 
          style={{ width: '100%', background: 'var(--color-error)' }}
        >
          <Maximize size={18} />
          Volver a pantalla completa
        </button>
      </div>
      
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
  )
}
