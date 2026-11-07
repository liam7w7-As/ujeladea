import Modal from './Modal'

export default function AdvertenciaOverlay({ isOpen, onContinuar, inicial = false }) {
  return <Modal isOpen={isOpen} onClose={onContinuar} onConfirm={onContinuar} titulo={inicial ? 'Antes de responder' : 'Vuelve al examen'} mensaje={inicial ? 'Mantén el examen como única vista de trabajo. Al continuar solicitaremos pantalla completa si tu navegador lo permite. El reloj de la sala ya está corriendo; no se reinicia con este paso.' : 'Saliste de la vista de pantalla completa. Tu progreso confirmado se conserva y continuarás desde la pregunta pendiente. Si aparece una solicitud de autorización, avisa al moderador. El reloj sigue corriendo.'} textoConfirmar={inicial ? 'Comenzar a responder' : 'Continuar mi examen'} />
}
