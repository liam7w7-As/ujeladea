-- Primer ingreso directo; la recuperación de una salida conserva la aprobación del moderador.
BEGIN;
CREATE OR REPLACE FUNCTION app_private.examen_registrar(p_sesion uuid,p_participante uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE s public.sesiones; e public.etapas; p public.participantes; intento uuid;
BEGIN
  PERFORM app_private.examen_uid();
  SELECT * INTO s FROM public.sesiones WHERE id=p_sesion;
  SELECT * INTO e FROM public.etapas WHERE id=s.etapa_id FOR SHARE;
  SELECT * INTO s FROM public.sesiones WHERE id=p_sesion FOR SHARE;
  IF s.id IS NULL OR s.eliminada_at IS NOT NULL OR NOT app_private.etapa_admite_examen(e.id) OR s.estado NOT IN ('esperando','activo') THEN
    RAISE EXCEPTION 'La sesión no está disponible para registrarte.';
  END IF;
  IF s.estado='activo' AND clock_timestamp()>=s.iniciado_at+make_interval(mins=>s.tiempo_limite) THEN RAISE EXCEPTION 'El tiempo de la sesión terminó.'; END IF;
  IF coalesce((e.reglas->>'version')::int,2)>=3 THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(e.id::text||auth.uid()::text,0));
    IF EXISTS(SELECT 1 FROM public.intentos x JOIN public.sesiones z ON z.id=x.sesion_id WHERE z.eliminada_at IS NULL AND x.etapa_id=e.id AND x.usuario_id=auth.uid() AND x.participante_id<>p_participante) THEN RAISE EXCEPTION 'Ya tienes una evaluación en esta etapa. Solicita ayuda al moderador.'; END IF;
  END IF;
  SELECT * INTO p FROM public.participantes WHERE id=p_participante AND sesion_id=p_sesion FOR UPDATE;
  IF NOT FOUND OR p.examen_finalizado THEN RAISE EXCEPTION 'Este participante no está disponible.'; END IF;
  SELECT id INTO intento FROM public.intentos WHERE participante_id=p.id AND usuario_id=auth.uid();
  IF intento IS NOT NULL THEN RETURN app_private.examen_payload(intento); END IF;
  IF EXISTS (SELECT 1 FROM public.intentos WHERE participante_id=p.id) THEN RAISE EXCEPTION 'Ese nombre ya está registrado en otro dispositivo.' USING ERRCODE='23505'; END IF;
  IF EXISTS (SELECT 1 FROM public.intentos WHERE sesion_id=s.id AND usuario_id=auth.uid()) THEN RAISE EXCEPTION 'Este dispositivo ya tiene un participante en la sesión.' USING ERRCODE='23505'; END IF;
  INSERT INTO public.intentos(participante_id,usuario_id,sesion_id,etapa_id,cantidad_preguntas)
    VALUES(p.id,auth.uid(),s.id,e.id,s.cantidad_preguntas) RETURNING id INTO intento;
  UPDATE public.participantes SET registrado_at=clock_timestamp(),seed=intento::text WHERE id=p.id;
  IF coalesce((e.reglas->>'version')::int,2)>=3 THEN
    INSERT INTO app_private.control_intentos(intento_id,instancia,solicitante,ultimo_contacto,solicitado_at,requiere_aprobacion,motivo)
    VALUES(intento,app_private.instancia_examen(),app_private.instancia_examen(),clock_timestamp(),clock_timestamp(),false,'Ingreso inicial confirmado');
  END IF;
  PERFORM app_private.examen_iniciar(intento);
  RETURN app_private.examen_payload(intento);
END; $$;

-- Libera únicamente registros iniciales que quedaron pendientes por la regla anterior.
UPDATE app_private.control_intentos c SET requiere_aprobacion=false,ultimo_contacto=clock_timestamp(),motivo='Ingreso inicial confirmado'
FROM public.intentos i JOIN public.sesiones s ON s.id=i.sesion_id JOIN public.etapas e ON e.id=i.etapa_id
WHERE c.intento_id=i.id AND i.estado='registrado' AND NOT e.historica AND e.estado<>'cerrada'
 AND (e.reglas->>'version')::int>=3 AND s.eliminada_at IS NULL AND s.estado IN('esperando','activo')
 AND (s.estado='esperando' OR clock_timestamp()<s.iniciado_at+make_interval(mins=>s.tiempo_limite))
 AND c.requiere_aprobacion AND c.instancia=c.solicitante AND c.oculto_desde IS NULL
 AND c.motivo IN('Registro pendiente de autorización','Primer ingreso: verificar identidad')
 AND NOT EXISTS(SELECT 1 FROM public.incidencias_examen a WHERE a.intento_id=i.id AND a.tipo IN('salida','traslado'))
 AND NOT EXISTS(SELECT 1 FROM app_private.episodios_supervision v WHERE v.intento_id=i.id AND v.requiere_revision);
COMMIT;
