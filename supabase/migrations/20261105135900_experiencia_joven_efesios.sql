-- Metadatos seguros, constancia de entrega y asistencia. Sin cambios de calificación o datos históricos.
BEGIN;
ALTER TABLE public.incidencias_examen DROP CONSTRAINT incidencias_examen_tipo_check;
ALTER TABLE public.incidencias_examen ADD CONSTRAINT incidencias_examen_tipo_check CHECK(tipo IN('solicitud','autorizacion','salida','justificacion','traslado','calificacion','ayuda','ayuda_atendida'));
CREATE INDEX incidencias_ayuda_atendida_idx ON public.incidencias_examen(intento_id,detalle) WHERE tipo='ayuda_atendida';
CREATE INDEX incidencias_ayuda_idx ON public.incidencias_examen(sesion_id,created_at) WHERE tipo='ayuda';
CREATE OR REPLACE FUNCTION app_private.examen_payload(p_intento uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
DECLARE i public.intentos; s public.sesiones; e public.etapas; p public.participantes; q public.intento_preguntas; c app_private.control_intentos; acceso jsonb; permitido boolean;
BEGIN
  SELECT * INTO i FROM public.intentos WHERE id=p_intento AND usuario_id=app_private.examen_uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'No tienes acceso a este intento.' USING ERRCODE='42501'; END IF;
  SELECT * INTO s FROM public.sesiones WHERE id=i.sesion_id;
  SELECT * INTO e FROM public.etapas WHERE id=i.etapa_id;
  SELECT * INTO p FROM public.participantes WHERE id=i.participante_id;
  IF i.estado='en_curso' THEN
    SELECT a.* INTO q FROM public.intento_preguntas a WHERE a.intento_id=i.id
      AND NOT EXISTS (SELECT 1 FROM public.respuestas r WHERE r.intento_pregunta_id=a.id) ORDER BY a.posicion LIMIT 1;
  END IF;
  IF coalesce(app_private.supervision_v3(i.id),false) AND i.estado<>'finalizado' THEN
    SELECT * INTO c FROM app_private.control_intentos WHERE intento_id=i.id;
    permitido:=coalesce(c.instancia=app_private.instancia_examen() AND NOT c.requiere_aprobacion AND c.ultimo_contacto>=clock_timestamp()-interval '60 seconds' AND (c.oculto_desde IS NULL OR c.oculto_desde>=clock_timestamp()-interval '15 seconds'),false);
    acceso:=jsonb_build_object('pendiente',NOT permitido,'motivo',coalesce(c.motivo,'Solicita autorización al moderador'),'otra_pantalla',coalesce(c.instancia<>app_private.instancia_examen(),false),'solicitado',coalesce(c.solicitante=app_private.instancia_examen(),false));
    IF NOT permitido THEN q:=NULL; END IF;
  END IF;
  RETURN jsonb_build_object('acceso',acceso,'version',2,'servidor_at',clock_timestamp(),
    'etapa',jsonb_build_object('id',e.id,'nombre',e.nombre,'libro',e.libro,'anio',e.anio,'cantidad_preguntas',e.cantidad_preguntas,'distribucion',e.reglas->'distribucion'),
    'sesion',jsonb_build_object('id',s.id,'estado',s.estado,'tiempo_limite',s.tiempo_limite,'vence_at',s.iniciado_at+make_interval(mins=>s.tiempo_limite),'sociedad',(SELECT nombre FROM public.sociedades WHERE id=s.sociedad_id)),
    'participante',jsonb_build_object('id',p.id,'nombre',p.nombre),
    'intento',jsonb_build_object('id',i.id,'estado',i.estado,'total',i.cantidad_preguntas,
      'respondidas',(SELECT count(*) FROM public.respuestas WHERE intento_id=i.id),'vence_at',i.vence_at,'motivo_cierre',i.motivo_cierre,'finalizado_at',i.finalizado_at),
    'ayuda',(SELECT jsonb_build_object('id',a.id,'created_at',a.created_at,
      'atendida_at',(SELECT min(x.created_at) FROM public.incidencias_examen x WHERE x.intento_id=i.id AND x.tipo='ayuda_atendida' AND x.detalle=a.id::text))
      FROM public.incidencias_examen a WHERE a.intento_id=i.id AND a.tipo='ayuda' ORDER BY a.created_at DESC,a.id DESC LIMIT 1),
    'pregunta',CASE WHEN q.id IS NULL THEN NULL ELSE jsonb_build_object('id',q.id,'posicion',q.posicion,'tipo',q.tipo,
      'texto',q.texto,'opciones',q.opciones,'puntaje',q.puntaje,'borrador',q.borrador,'revision',q.revision) END);
END; $$;
CREATE OR REPLACE FUNCTION app_private.examen_sala(p_sesion uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE s public.sesiones; e public.etapas; propio uuid; abierta boolean;
BEGIN
  PERFORM app_private.examen_uid();
  SELECT * INTO s FROM public.sesiones WHERE id=p_sesion;
  SELECT * INTO e FROM public.etapas WHERE id=s.etapa_id AND NOT historica;
  IF s.id IS NULL OR e.id IS NULL THEN RAISE EXCEPTION 'La sesión no está disponible.'; END IF;
  SELECT id INTO propio FROM public.intentos WHERE sesion_id=s.id AND usuario_id=auth.uid();
  abierta:=e.estado='activa' AND (s.estado='esperando' OR (s.estado='activo' AND clock_timestamp()<s.iniciado_at+make_interval(mins=>s.tiempo_limite)));
  RETURN jsonb_build_object('servidor_at',clock_timestamp(),'sesion',jsonb_build_object('id',s.id,'estado',s.estado,
    'tiempo_limite',s.tiempo_limite,'iniciado_at',s.iniciado_at,'vence_at',s.iniciado_at+make_interval(mins=>s.tiempo_limite),'sociedad',(SELECT nombre FROM public.sociedades WHERE id=s.sociedad_id)),
    'etapa',jsonb_build_object('libro',e.libro,'nombre',e.nombre,'anio',e.anio,'cantidad_preguntas',e.cantidad_preguntas,'distribucion',e.reglas->'distribucion'),
    'disponible',abierta,'intento_id',propio,
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
    'servidor_at',clock_timestamp(),
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
    WHERE s.id=p_sesion AND s.etapa_id=p_etapa;
  IF resultado IS NULL THEN RAISE EXCEPTION 'Esta sesión no pertenece a la etapa seleccionada.' USING ERRCODE='42501'; END IF;
  RETURN resultado;
END; $$;

-- La asistencia se registra aparte de las señales del navegador. No altera notas ni plazos.
CREATE FUNCTION app_private.examen_ayuda(p_intento uuid,p_motivo text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.intentos; a public.incidencias_examen;
BEGIN
  SELECT * INTO i FROM public.intentos WHERE id=p_intento AND usuario_id=app_private.examen_uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No tienes acceso a este intento.' USING ERRCODE='42501'; END IF;
  PERFORM app_private.validar_acceso(i.id);
  IF i.estado<>'en_curso' OR i.vence_at<=clock_timestamp() OR NOT EXISTS(SELECT 1 FROM public.sesiones WHERE id=i.sesion_id AND estado='activo') THEN
    RAISE EXCEPTION 'La evaluación ya no admite solicitudes. Avisa al moderador.';
  END IF;
  IF p_motivo IS NULL OR p_motivo NOT IN('Problema con el dispositivo','No puedo continuar','Necesito hablar con el moderador') THEN
    RAISE EXCEPTION 'Selecciona un motivo de asistencia.';
  END IF;
  SELECT * INTO a FROM public.incidencias_examen WHERE intento_id=i.id AND tipo='ayuda' ORDER BY created_at DESC,id DESC LIMIT 1;
  IF a.id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.incidencias_examen WHERE intento_id=i.id AND tipo='ayuda_atendida' AND detalle=a.id::text) THEN
    RETURN app_private.examen_payload(i.id);
  END IF;
  IF a.created_at>clock_timestamp()-interval '30 seconds' THEN RAISE EXCEPTION 'Espera unos segundos antes de enviar otra solicitud. Puedes avisar al moderador en persona.'; END IF;
  INSERT INTO public.incidencias_examen(intento_id,sesion_id,actor_id,tipo,detalle) VALUES(i.id,i.sesion_id,auth.uid(),'ayuda',p_motivo);
  RETURN app_private.examen_payload(i.id);
END; $$;

CREATE FUNCTION app_private.admin_examen_atender_ayuda(p_solicitud uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.incidencias_examen;
BEGIN
  IF NOT app_private.es_admin() THEN RAISE EXCEPTION 'Solo administradores.' USING ERRCODE='42501'; END IF;
  SELECT * INTO a FROM public.incidencias_examen WHERE id=p_solicitud AND tipo='ayuda' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró esta solicitud.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.incidencias_examen WHERE intento_id=a.intento_id AND tipo='ayuda_atendida' AND detalle=a.id::text) THEN
    INSERT INTO public.incidencias_examen(intento_id,sesion_id,actor_id,tipo,detalle) VALUES(a.intento_id,a.sesion_id,auth.uid(),'ayuda_atendida',a.id::text);
  END IF;
  RETURN jsonb_build_object('atendida',true);
END; $$;

CREATE FUNCTION public.examen_ayuda(p_intento uuid,p_motivo text) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT app_private.examen_ayuda($1,$2) $$;
CREATE FUNCTION public.admin_examen_atender_ayuda(p_solicitud uuid) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT app_private.admin_examen_atender_ayuda($1) $$;
REVOKE ALL ON FUNCTION app_private.examen_ayuda(uuid,text),app_private.admin_examen_atender_ayuda(uuid),public.examen_ayuda(uuid,text),public.admin_examen_atender_ayuda(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.examen_ayuda(uuid,text),app_private.admin_examen_atender_ayuda(uuid),public.examen_ayuda(uuid,text),public.admin_examen_atender_ayuda(uuid) TO authenticated;

COMMIT;
