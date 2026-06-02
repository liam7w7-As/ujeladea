import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'

export default function Modal({ isOpen, onClose, onConfirm, titulo, mensaje, tipo = 'info', textoConfirmar = 'Aceptar', textoCancelar = 'Cancelar', isConfirm = false }) {
  if (!isOpen) return null;

  const getIcon = () => {
    switch(tipo) {
      case 'error': return <AlertCircle size={32} color="var(--color-error)" />;
      case 'success': return <CheckCircle2 size={32} color="var(--color-success)" />;
      case 'warning': return <AlertCircle size={32} color="var(--color-warning)" />;
      default: return <Info size={32} color="var(--color-info)" />;
    }
  }

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-md)' }}>
      <div className="card animate-in" style={{ maxWidth: '400px', width: '100%', position: 'relative', padding: 'var(--space-2xl) var(--space-xl) var(--space-xl)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-lg)' }}>
        <button 
          onClick={onClose} 
          style={{ position: 'absolute', top: '16px', right: '16px', background: 'var(--color-bg-base)', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', cursor: 'pointer', borderRadius: '50%', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}
        >
          <X size={16}/>
        </button>
        
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-md)' }}>
          {getIcon()}
          <h3 style={{ marginTop: 'var(--space-sm)', fontSize: '1.3rem', color: 'var(--color-text-primary)' }}>{titulo}</h3>
        </div>
        
        <p style={{ textAlign: 'center', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-xl)', fontSize: '1rem', lineHeight: 1.5 }}>
          {mensaje}
        </p>

        <div style={{ display: 'flex', gap: 'var(--space-md)', justifyContent: 'center' }}>
          {isConfirm && (
            <button onClick={onClose} className="btn btn-secondary" style={{ flex: 1, padding: '0.8rem' }}>{textoCancelar}</button>
          )}
          <button 
            onClick={() => { if(onConfirm) onConfirm(); else onClose(); }} 
            className="btn btn-primary" 
            style={{ 
              flex: 1, 
              padding: '0.8rem', 
              background: tipo === 'error' ? 'var(--color-error)' : (tipo === 'warning' ? 'var(--color-warning)' : undefined) 
            }}
          >
            {textoConfirmar}
          </button>
        </div>
      </div>
    </div>
  )
}
