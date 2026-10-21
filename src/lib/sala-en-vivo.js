// Realtime acelera la actualización; cada lectura completa recupera también eventos perdidos.
export class SalaEnVivo {
  constructor({ client, sesion, etapa, onDatos, onError, onConexion, ventana=globalThis.window, documento=globalThis.document, cada=15000, agrupar=1000 }) {
    Object.assign(this,{client,sesion,etapa,onDatos,onError,onConexion,ventana,documento,cada,agrupar})
    this.detenido=false
    this.pendiente=false
    this.operacion=null
    this.alVolver=()=>{if(this.visible()&&this.enLinea())void this.recargar()}
    this.alSalir=()=>this.conexion('sin_red')
  }
  visible(){return this.documento?.visibilityState!=='hidden'}
  enLinea(){return this.ventana?.navigator?.onLine!==false}
  conexion(estado){if(!this.detenido){this.estadoConexion=estado;this.onConexion(estado)}}
  iniciar(){
    this.ventana?.addEventListener('focus',this.alVolver)
    this.ventana?.addEventListener('online',this.alVolver)
    this.ventana?.addEventListener('offline',this.alSalir)
    this.documento?.addEventListener('visibilitychange',this.alVolver)
    this.intervalo=setInterval(()=>this.alVolver(),this.cada)
    this.canal=this.client.channel('sala_control_'+this.sesion+'_'+Math.random().toString(36).slice(2))
      .on('postgres_changes',{event:'*',schema:'public',table:'participantes',filter:'sesion_id=eq.'+this.sesion},()=>this.programar())
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'sesiones',filter:'id=eq.'+this.sesion},()=>this.programar())
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'eventos_sesion',filter:'sesion_id=eq.'+this.sesion},()=>this.programar())
      .subscribe(estado=>{
        if(this.detenido)return
        this.conexion(!this.enLinea()?'sin_red':estado==='SUBSCRIBED'?'en_vivo':'consulta')
        if(estado==='SUBSCRIBED')void this.recargar()
      })
    return this.recargar()
  }
  programar(){
    if(this.detenido||this.temporizador)return
    this.temporizador=setTimeout(()=>{this.temporizador=null;if(this.visible()&&this.enLinea())void this.recargar()},this.agrupar)
  }
  recargar(){
    if(this.detenido)return Promise.resolve()
    this.pendiente=true
    if(this.operacion)return this.operacion
    this.operacion=(async()=>{
      while(this.pendiente&&!this.detenido){
        this.pendiente=false
        try{
          const {data,error}=await this.client.rpc('admin_examen_sala',{p_sesion:this.sesion,p_etapa:this.etapa})
          if(error)throw error
          if(!data?.sesion||data.sesion.id!==this.sesion||data.sesion.etapa_id!==this.etapa||!Array.isArray(data.participantes)||!Array.isArray(data.alertas))throw new Error('No se pudo leer el estado de esta sala.')
          if(!this.detenido){if(this.estadoConexion==='sin_red')this.conexion('consulta');this.onDatos({...data,recibidoEn:Date.now()})}
        }catch(error){if(!this.detenido)this.onError(error)}
      }
    })().finally(()=>{this.operacion=null})
    return this.operacion
  }
  destruir(){
    if(this.detenido)return
    this.detenido=true;this.pendiente=false
    clearInterval(this.intervalo);clearTimeout(this.temporizador)
    this.ventana?.removeEventListener('focus',this.alVolver)
    this.ventana?.removeEventListener('online',this.alVolver)
    this.ventana?.removeEventListener('offline',this.alSalir)
    this.documento?.removeEventListener('visibilitychange',this.alVolver)
    if(this.canal)void this.client.removeChannel(this.canal)
  }
}
