import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { SalaEnVivo } from '../lib/sala-en-vivo'
import { mensajeErrorEtapas } from '../lib/etapas'

export default function useSalaControl(sesion,etapa) {
  const clave=sesion+':'+etapa
  const [estado,setEstado]=useState({clave:'',datos:null,error:'',conexion:'consulta',cargando:true})
  const control=useRef(null)
  useEffect(()=>{
    const observador=new SalaEnVivo({
      client:supabase,sesion,etapa,
      onDatos:datos=>setEstado(prev=>({...prev,clave,datos,error:'',cargando:false})),
      onError:error=>setEstado(prev=>({...prev,clave,error:mensajeErrorEtapas(error),cargando:false})),
      onConexion:conexion=>setEstado(prev=>({...prev,conexion})),
    })
    control.current=observador
    void observador.iniciar()
    return ()=>{control.current=null;observador.destruir()}
  },[sesion,etapa,clave])
  const recargar=useCallback(()=>control.current?.recargar()||Promise.resolve(),[])
  return {...estado,datos:estado.clave===clave?estado.datos:null,cargando:estado.clave!==clave||estado.cargando,recargar}
}
