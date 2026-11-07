-- Metadatos de acceso: conserva las mismas reglas y no modifica resultados ni configuración.
BEGIN;
CREATE OR REPLACE FUNCTION app_private.examen_sala(p_sesion uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE s public.sesiones; e public.etapas; propio uuid; abierta boolean;
BEGIN
  PERFORM app_private.examen_uid();
  SELECT * INTO s FROM public.sesiones WHERE id=p_sesion AND eliminada_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Esta sesión no está disponible.' USING ERRCODE='42501'; END IF;
  SELECT * INTO e FROM public.etapas WHERE id=s.etapa_id AND NOT historica;
  IF s.id IS NULL OR e.id IS NULL THEN RAISE EXCEPTION 'La sesión no está disponible.'; END IF;
  SELECT id INTO propio FROM public.intentos WHERE sesion_id=s.id AND usuario_id=auth.uid();
  abierta:=e.estado='activa' AND (s.estado='esperando' OR (s.estado='activo' AND clock_timestamp()<s.iniciado_at+make_interval(mins=>s.tiempo_limite)));
  RETURN jsonb_build_object('servidor_at',clock_timestamp(),'sesion',jsonb_build_object('id',s.id,'estado',s.estado,
    'tiempo_limite',s.tiempo_limite,'iniciado_at',s.iniciado_at,'vence_at',s.iniciado_at+make_interval(mins=>s.tiempo_limite),'sociedad',(SELECT nombre FROM public.sociedades WHERE id=s.sociedad_id)),
    'etapa',jsonb_build_object('estado',e.estado,'libro',e.libro,'nombre',e.nombre,'anio',e.anio,'cantidad_preguntas',s.cantidad_preguntas,'distribucion',coalesce(s.distribucion,e.reglas->'distribucion')),
    'disponible',abierta,'motivo_no_disponible',CASE WHEN abierta THEN NULL
      WHEN e.estado='borrador' THEN 'etapa_en_preparacion'
      WHEN e.estado='cerrada' THEN 'etapa_cerrada'
      WHEN s.estado='finalizado' THEN 'sesion_finalizada'
      WHEN s.estado='activo' THEN 'tiempo_finalizado'
      ELSE 'sesion_no_disponible' END,'intento_id',propio,
    'participantes',CASE WHEN abierta AND propio IS NULL THEN
      (SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'nombre',p.nombre) ORDER BY p.nombre),'[]'::jsonb)
        FROM public.participantes p WHERE p.sesion_id=s.id AND NOT p.examen_finalizado
        AND NOT EXISTS (SELECT 1 FROM public.intentos i WHERE i.participante_id=p.id))
      ELSE '[]'::jsonb END);
END; $$;

CREATE OR REPLACE FUNCTION app_private.admin_examen_sala(p_sesion uuid,p_etapa uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE resultado jsonb;
BEGIN
  IF NOT app_private.es_admin() THEN RAISE EXCEPTION 'Solo administradores.' USING ERRCODE='42501'; END IF;
  SELECT jsonb_build_object(
    'servidor_at',clock_timestamp(),'etapa_estado',(SELECT estado FROM public.etapas WHERE id=s.etapa_id),
    'ayudas',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'intento_id',a.intento_id,'nombre',p.nombre,'motivo',a.detalle,'created_at',a.created_at) ORDER BY a.created_at,a.id),'[]'::jsonb)
      FROM public.incidencias_examen a JOIN public.intentos i ON i.id=a.intento_id JOIN public.participantes p ON p.id=i.participante_id
      WHERE a.sesion_id=s.id AND a.tipo='ayuda' AND i.estado<>'finalizado'
      AND NOT EXISTS(SELECT 1 FROM public.incidencias_examen x WHERE x.intento_id=i.id AND x.tipo='ayuda_atendida' AND x.detalle=a.id::text)),
    'sesion',to_jsonb(s)||jsonb_build_object('sociedades',jsonb_build_object('nombre',soc.nombre,'total_censo',soc.total_censo)),
    'participantes',(SELECT coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object(
      'respondidas',(SELECT count(*) FROM public.respuestas r WHERE r.intento_id=i.id),
      'total',i.cantidad_preguntas,'intento_id',i.id,'requiere_aprobacion',c.requiere_aprobacion,'ultimo_contacto',c.ultimo_contacto,'motivo_acceso',c.motivo,'justificacion_acceso',c.justificacion,'solicitante',c.solicitante IS NOT NULL,'sin_comunicacion',c.ultimo_contacto<clock_timestamp()-interval '60 seconds') ORDER BY p.nombre,p.id),'[]'::jsonb)
      FROM public.participantes p LEFT JOIN public.intentos i ON i.participante_id=p.id LEFT JOIN app_private.control_intentos c ON c.intento_id=i.id WHERE p.sesion_id=s.id),
    'alertas',(SELECT coalesce(jsonb_agg(jsonb_build_object(
      'participante_id',a.participante_id,'total_eventos',a.total,
      'detalle',(SELECT jsonb_agg(jsonb_build_object('tipo',d.tipo,'cantidad',d.cantidad,'ultimo_at',d.ultimo_at) ORDER BY d.tipo)
        FROM (SELECT tipo,sum(cantidad) cantidad,max(ultimo_at) ultimo_at FROM public.eventos_sesion
          WHERE sesion_id=s.id AND participante_id=a.participante_id GROUP BY tipo) d)
      ) ORDER BY a.participante_id),'[]'::jsonb)
      FROM (SELECT participante_id,count(*) total FROM public.eventos_sesion WHERE sesion_id=s.id GROUP BY participante_id) a)
  ) INTO resultado FROM public.sesiones s LEFT JOIN public.sociedades soc ON soc.id=s.sociedad_id
    WHERE s.id=p_sesion AND s.etapa_id=p_etapa AND s.eliminada_at IS NULL;
  IF resultado IS NULL THEN RAISE EXCEPTION 'Esta sesión no pertenece a la etapa seleccionada.' USING ERRCODE='42501'; END IF;
  RETURN resultado;
END; $$;
COMMIT;
