import Modal from './Modal'

export default function AdvertenciaOverlay({ isOpen, onContinuar }) {
  return <Modal isOpen={isOpen} onClose={onContinuar} onConfirm={onContinuar} titulo="Vuelve al examen" mensaje="Saliste de la vista de pantalla completa. Tu progreso confirmado se conserva y continuarás desde la pregunta pendiente. Si aparece una solicitud de autorización, avisa al moderador. El reloj sigue corriendo." textoConfirmar="Continuar mi examen" />
}
