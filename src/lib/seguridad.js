export class SeguridadExamen {
  constructor(participanteId, sesionId, supabaseClient, onAdvertencia) {
    this.participanteId = participanteId;
    this.sesionId = sesionId;
    this.supabase = supabaseClient;
    this.onAdvertencia = onAdvertencia; 
    
    // Bind methods 
    this.handleFullscreenChange = this.handleFullscreenChange.bind(this);
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
    this.handleContextMenu = this.handleContextMenu.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    
    this.activo = false;
    this.advertenciasLocales = 0;

    // Throttle: no enviar el mismo tipo de evento más de 1 vez cada 5 segundos
    this._ultimoEventoPorTipo = {};
    this._colaEventos = [];
    this._flushTimer = null;
  }

  async iniciar() {
    if (this.activo) return;
    this.activo = true;

    // 1. Intentar Fullscreen si está soportado y habilitado
    if (document.fullscreenEnabled) {
      try {
        await document.documentElement.requestFullscreen();
      } catch (err) {
        console.warn("Fullscreen API falló o no está disponible", err);
      }
      document.addEventListener('fullscreenchange', this.handleFullscreenChange);
    }

    // 2. Visibilidad (cambio de pestaña)
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    
    // 3. Clic derecho
    document.addEventListener('contextmenu', this.handleContextMenu);
    
    // 4. Teclado
    document.addEventListener('keydown', this.handleKeyDown);
  }

  destruir() {
    this.activo = false;
    document.removeEventListener('fullscreenchange', this.handleFullscreenChange);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    document.removeEventListener('contextmenu', this.handleContextMenu);
    document.removeEventListener('keydown', this.handleKeyDown);
    
    // Flush cualquier evento pendiente antes de destruir
    this._flushEventos();
    if (this._flushTimer) clearTimeout(this._flushTimer);

    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
  }

  // Throttle: máximo 1 evento del mismo tipo cada 5 segundos
  _puedeEnviar(tipo) {
    const ahora = Date.now();
    const ultimo = this._ultimoEventoPorTipo[tipo] || 0;
    if (ahora - ultimo < 5000) return false;
    this._ultimoEventoPorTipo[tipo] = ahora;
    return true;
  }

  // Batch: acumular eventos y enviarlos cada 3 segundos en lote
  _encolarEvento(tipo) {
    this._colaEventos.push({
      participante_id: this.participanteId,
      sesion_id: this.sesionId,
      tipo: tipo
    });

    if (!this._flushTimer) {
      this._flushTimer = setTimeout(() => this._flushEventos(), 3000);
    }
  }

  async _flushEventos() {
    this._flushTimer = null;
    if (this._colaEventos.length === 0) return;

    const lote = [...this._colaEventos];
    this._colaEventos = [];

    try {
      const { error } = await this.supabase
        .from('eventos_sesion')
        .insert(lote);
      if (error) console.error("Error registrando lote de eventos:", error);
    } catch (e) {
      console.error("Excepción registrando lote de eventos", e);
    }
  }

  registrarEvento(tipo, notificarUI = false) {
    if (!this._puedeEnviar(tipo)) return;

    this._encolarEvento(tipo);
    
    if (notificarUI) {
      this.advertenciasLocales += 1;
      if (this.onAdvertencia) {
        this.onAdvertencia(tipo, this.advertenciasLocales);
      }
    }
  }

  handleFullscreenChange() {
    if (!this.activo) return;
    if (!document.fullscreenElement) {
      this.registrarEvento('salio_fullscreen', true);
    }
  }

  handleVisibilityChange() {
    if (!this.activo) return;
    if (document.hidden) {
      this.registrarEvento('cambio_pestana', true);
    }
  }

  handleContextMenu(e) {
    if (this.activo) {
      e.preventDefault();
      this.registrarEvento('intento_clic_derecho', false);
    }
  }

  handleKeyDown(e) {
    if (!this.activo) return;

    // F12
    if (e.key === 'F12') {
      e.preventDefault();
      this.registrarEvento('devtools_detectado', false);
    }
    
    // Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+U
    if (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'i' || e.key === 'J' || e.key === 'j')) {
      e.preventDefault();
      this.registrarEvento('devtools_detectado', false);
    }
    
    if (e.ctrlKey && (e.key === 'U' || e.key === 'u')) {
      e.preventDefault();
      this.registrarEvento('devtools_detectado', false);
    }

    // Ctrl+S
    if (e.ctrlKey && (e.key === 'S' || e.key === 's')) {
      e.preventDefault();
      this.registrarEvento('devtools_detectado', false);
    }

    // Ctrl+C, Ctrl+A (Solo registrar, no bloquear)
    if (e.ctrlKey && (e.key === 'C' || e.key === 'c' || e.key === 'A' || e.key === 'a')) {
      this.registrarEvento('intento_copiar', false);
    }
  }
}
