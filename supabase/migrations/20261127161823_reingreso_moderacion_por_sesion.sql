-- Los permisos de moderación pertenecen a una sola sesión y se validan en el servidor.
BEGIN;

CREATE TABLE app_private.invitaciones_moderacion (
  codigo_hash bytea PRIMARY KEY,
  sesion_id uuid NOT NULL REFERENCES public.sesiones(id) ON DELETE CASCADE,
  creada_por uuid NOT NULL,
  vence_at timestamptz NOT NULL,
  usuario_id uuid,
  revocada_at timestamptz
);
CREATE INDEX invitaciones_moderacion_sesion_usuario_idx ON app_private.invitaciones_moderacion (sesion_id, usuario_id);
ALTER TABLE app_private.invitaciones_moderacion ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app_private.invitaciones_moderacion FROM PUBLIC, anon, authenticated;

CREATE FUNCTION app_private.moderacion_asignada(p_sesion uuid) RETURNS boolean
LANGUAGE sql VOLATILE SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM app_private.invitaciones_moderacion m
    WHERE m.sesion_id = p_sesion AND m.usuario_id = auth.uid()
      AND m.revocada_at IS NULL AND m.vence_at > clock_timestamp()
  )
$$;
REVOKE ALL ON FUNCTION app_private.moderacion_asignada(uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION app_private.puede_moderar(p_sesion uuid) RETURNS boolean
LANGUAGE sql VOLATILE SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.sesiones s JOIN public.etapas e ON e.id = s.etapa_id
    WHERE s.id = p_sesion AND s.eliminada_at IS NULL AND s.estado IN ('esperando','activo')
      AND NOT e.historica AND e.estado <> 'cerrada' AND (e.reglas->>'version')::int >= 3
      AND app_private.moderacion_asignada(s.id)
  )
$$;
REVOKE ALL ON FUNCTION app_private.puede_moderar(uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION app_private.admin_moderacion_enlace(p_sesion uuid, p_revocar boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE codigo text; vence timestamptz;
BEGIN
  IF NOT app_private.es_admin() THEN
    RAISE EXCEPTION 'Solo la directiva administra los accesos.' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.sesiones s JOIN public.etapas e ON e.id = s.etapa_id
  WHERE s.id = p_sesion AND s.eliminada_at IS NULL AND s.estado IN ('esperando','activo')
    AND NOT e.historica AND e.estado <> 'cerrada' AND (e.reglas->>'version')::int >= 3
  FOR UPDATE OF s;
  IF NOT FOUND THEN RAISE EXCEPTION 'Esta sesión no admite accesos de moderación.' USING ERRCODE = '42501'; END IF;
  IF p_revocar IS TRUE THEN
    UPDATE app_private.invitaciones_moderacion SET revocada_at = clock_timestamp()
    WHERE sesion_id = p_sesion AND revocada_at IS NULL;
    RETURN jsonb_build_object('revocados', true);
  END IF;
  codigo := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  vence := clock_timestamp() + interval '24 hours';
  INSERT INTO app_private.invitaciones_moderacion(codigo_hash,sesion_id,creada_por,vence_at)
  VALUES (sha256(convert_to(codigo,'UTF8')),p_sesion,auth.uid(),vence);
  RETURN jsonb_build_object('codigo',codigo,'vence_at',vence);
END; $$;

CREATE FUNCTION app_private.moderacion_entrar(p_sesion uuid, p_codigo text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE etapa jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Abre el enlace de moderación.' USING ERRCODE = '42501'; END IF;
  SELECT jsonb_build_object('id',e.id,'libro',e.libro,'estado',e.estado) INTO etapa
  FROM public.sesiones s JOIN public.etapas e ON e.id = s.etapa_id
  WHERE s.id = p_sesion AND s.eliminada_at IS NULL AND s.estado IN ('esperando','activo')
    AND NOT e.historica AND e.estado <> 'cerrada' AND (e.reglas->>'version')::int >= 3
  FOR SHARE OF s;
  IF etapa IS NOT NULL AND p_codigo ~ '^[0-9a-f]{64}$' THEN
    UPDATE app_private.invitaciones_moderacion SET usuario_id = auth.uid()
    WHERE codigo_hash = sha256(convert_to(p_codigo,'UTF8')) AND sesion_id = p_sesion
      AND usuario_id IS NULL AND revocada_at IS NULL AND vence_at > clock_timestamp();
  END IF;
  IF etapa IS NULL OR NOT app_private.puede_moderar(p_sesion) THEN
    RAISE EXCEPTION 'El acceso de moderación no está disponible. Pide otro enlace a la directiva.' USING ERRCODE = '42501';
  END IF;
  RETURN etapa;
END; $$;

CREATE FUNCTION app_private.moderacion_estado(p_sesion uuid, p_estado text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.sesiones;
BEGIN
  -- Mismo orden de bloqueo que el flujo de examen: etapa, sesión e intentos.
  PERFORM 1 FROM public.etapas WHERE id = (SELECT etapa_id FROM public.sesiones WHERE id = p_sesion) FOR SHARE;
  SELECT * INTO s FROM public.sesiones WHERE id = p_sesion FOR UPDATE;
  IF NOT app_private.puede_moderar(p_sesion) THEN
    RAISE EXCEPTION 'No tienes acceso a esta sesión.' USING ERRCODE = '42501';
  END IF;
  IF p_estado = 'activo' AND s.estado = 'esperando' THEN
    IF NOT EXISTS (SELECT 1 FROM public.participantes WHERE sesion_id = p_sesion AND registrado_at IS NOT NULL) THEN
      RAISE EXCEPTION 'Espera a que se registre al menos un participante.';
    END IF;
  ELSIF p_estado = 'finalizado' AND s.estado = 'activo' THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'Este cambio de estado no está permitido.';
  END IF;
  UPDATE public.sesiones SET estado = p_estado WHERE id = p_sesion;
  RETURN jsonb_build_object('estado',p_estado);
END; $$;

CREATE FUNCTION app_private.moderacion_incidencias(p_intento uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT app_private.puede_moderar((SELECT sesion_id FROM public.intentos WHERE id = p_intento)) THEN
    RAISE EXCEPTION 'No tienes acceso a esta sesión.' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC),'[]'::jsonb) FROM (
    SELECT tipo,detalle,created_at FROM public.incidencias_examen
    WHERE intento_id = p_intento AND tipo <> 'calificacion' ORDER BY created_at DESC LIMIT 50
  ) a);
END; $$;

CREATE FUNCTION app_private.cerrar_supervision_revisada(p_intento uuid) RETURNS void
LANGUAGE sql SET search_path = '' AS $$
  UPDATE app_private.episodios_supervision
  SET hasta = clock_timestamp(), activas = '[]'::jsonb, fuerte_desde = NULL,
      requiere_revision = requiere_revision OR coalesce(fuerte_desde <= clock_timestamp() - interval '15 seconds',false)
  WHERE intento_id = p_intento AND hasta IS NULL
$$;
REVOKE ALL ON FUNCTION app_private.cerrar_supervision_revisada(uuid) FROM PUBLIC, anon, authenticated;


CREATE OR REPLACE FUNCTION app_private.admin_examen_sala(p_sesion uuid,p_etapa uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE resultado jsonb;
BEGIN
  IF NOT app_private.es_admin() AND NOT app_private.puede_moderar(p_sesion) THEN
   RAISE EXCEPTION 'No tienes acceso a esta sesión.' USING ERRCODE='42501';
 END IF;
  SELECT jsonb_build_object(
    'servidor_at',clock_timestamp(),'etapa_estado',(SELECT estado FROM public.etapas WHERE id=s.etapa_id),
    'supervision',(SELECT coalesce(jsonb_agg(to_jsonb(z) ORDER BY z.desde DESC),'[]'::jsonb) FROM
      (SELECT v.episodio,i.participante_id,v.desde,v.hasta,v.senales,v.duracion_ms,v.requiere_revision FROM app_private.episodios_supervision v JOIN public.intentos i ON i.id=v.intento_id WHERE v.sesion_id=s.id ORDER BY v.desde DESC LIMIT 100) z),
    'ayudas',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'intento_id',a.intento_id,'nombre',p.nombre,'motivo',a.detalle,'created_at',a.created_at) ORDER BY a.created_at,a.id),'[]'::jsonb)
      FROM public.incidencias_examen a JOIN public.intentos i ON i.id=a.intento_id JOIN public.participantes p ON p.id=i.participante_id
      WHERE a.sesion_id=s.id AND a.tipo='ayuda' AND i.estado<>'finalizado'
      AND NOT EXISTS(SELECT 1 FROM public.incidencias_examen x WHERE x.intento_id=i.id AND x.tipo='ayuda_atendida' AND x.detalle=a.id::text)),
    'sesion',(CASE WHEN app_private.es_admin() THEN to_jsonb(s) ELSE jsonb_build_object('id',s.id,'etapa_id',s.etapa_id,'estado',s.estado,'tiempo_limite',s.tiempo_limite,'iniciado_at',s.iniciado_at) END)||jsonb_build_object('sociedades',jsonb_build_object('nombre',soc.nombre,'total_censo',soc.total_censo)),
    'participantes',(SELECT coalesce(jsonb_agg((CASE WHEN app_private.es_admin() THEN to_jsonb(p) ELSE jsonb_build_object('id',p.id,'nombre',p.nombre,'registrado_at',p.registrado_at,'examen_finalizado',p.examen_finalizado) END)||jsonb_build_object(
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

CREATE OR REPLACE FUNCTION app_private.admin_examen_agregar(p_sesion uuid,p_nombre text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.sesiones; pid uuid;
BEGIN
 IF NOT app_private.es_admin() AND NOT app_private.puede_moderar(p_sesion) THEN
   RAISE EXCEPTION 'No tienes acceso a esta sesión.' USING ERRCODE='42501';
 END IF;
 IF p_nombre IS NULL OR length(btrim(p_nombre)) NOT BETWEEN 2 AND 100 THEN RAISE EXCEPTION 'Revisa el nombre del participante.'; END IF;
 SELECT * INTO s FROM public.sesiones WHERE id=p_sesion;
 PERFORM 1 FROM public.etapas WHERE id=s.etapa_id AND app_private.etapa_admite_examen(id) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'La etapa no admite acceso.'; END IF;
 SELECT * INTO s FROM public.sesiones WHERE id=p_sesion FOR UPDATE;
 IF s.estado NOT IN('esperando','activo') OR (s.estado='activo' AND clock_timestamp()>=s.iniciado_at+make_interval(mins=>s.tiempo_limite)) THEN RAISE EXCEPTION 'La sesión ya terminó.'; END IF;
 IF EXISTS(SELECT 1 FROM public.participantes WHERE sesion_id=s.id AND lower(btrim(nombre))=lower(btrim(p_nombre))) THEN RAISE EXCEPTION 'Ya existe ese nombre en esta sesión.'; END IF;
 INSERT INTO public.participantes(sesion_id,nombre,del_censo) VALUES(s.id,btrim(p_nombre),false) RETURNING id INTO pid;
 RETURN jsonb_build_object('participante_id',pid,'vence_at',s.iniciado_at+make_interval(mins=>s.tiempo_limite));
END; $$;

CREATE OR REPLACE FUNCTION app_private.admin_examen_cerrar_vencida(p_sesion uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE s public.sesiones;
BEGIN
  IF NOT app_private.es_admin() AND NOT app_private.puede_moderar(p_sesion) THEN
   RAISE EXCEPTION 'No tienes acceso a esta sesión.' USING ERRCODE='42501';
 END IF;
  SELECT * INTO s FROM public.sesiones WHERE id=p_sesion;
  PERFORM 1 FROM public.etapas WHERE id=s.etapa_id FOR SHARE;
  SELECT * INTO s FROM public.sesiones WHERE id=p_sesion FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sesión no disponible.'; END IF;
  IF s.estado='finalizado' THEN RETURN jsonb_build_object('cerrada',true); END IF;
  IF s.estado='activo' AND clock_timestamp()>=s.iniciado_at+make_interval(mins=>s.tiempo_limite) THEN
    UPDATE public.sesiones SET estado='finalizado' WHERE id=s.id;
    RETURN jsonb_build_object('cerrada',true);
  END IF;
  RETURN jsonb_build_object('cerrada',false);
END; $$;

CREATE OR REPLACE FUNCTION app_private.admin_examen_justificar(p_intento uuid,p_justificacion text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.intentos;
BEGIN

 IF p_justificacion IS NULL OR length(btrim(p_justificacion)) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'Describe el incidente verificado.'; END IF;
 SELECT * INTO i FROM public.intentos WHERE id=p_intento;
 IF NOT app_private.es_admin() AND NOT app_private.puede_moderar(i.sesion_id) THEN
   RAISE EXCEPTION 'No tienes acceso a esta sesión.' USING ERRCODE='42501';
 END IF;
 PERFORM 1 FROM public.etapas WHERE id=i.etapa_id AND app_private.etapa_admite_examen(id) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'La etapa no admite revisar incidentes.'; END IF;
 UPDATE app_private.control_intentos SET justificacion=p_justificacion WHERE intento_id=i.id;
 INSERT INTO public.incidencias_examen(intento_id,sesion_id,actor_id,tipo,detalle) VALUES(i.id,i.sesion_id,auth.uid(),'justificacion',p_justificacion);
 RETURN jsonb_build_object('justificado',true);
END; $$;

CREATE OR REPLACE FUNCTION app_private.admin_examen_recuperacion(p_intento uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE i public.intentos; codigo text:=upper(replace(gen_random_uuid()::text,'-','')); caduca timestamptz;
BEGIN

  SELECT * INTO i FROM public.intentos WHERE id=p_intento;
 IF NOT app_private.es_admin() AND NOT app_private.puede_moderar(i.sesion_id) THEN
   RAISE EXCEPTION 'No tienes acceso a esta sesión.' USING ERRCODE='42501';
 END IF;
  PERFORM 1 FROM public.etapas WHERE id=i.etapa_id AND app_private.etapa_admite_examen(id) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La etapa no admite acceso.'; END IF;
  PERFORM 1 FROM public.sesiones WHERE id=i.sesion_id AND (estado='esperando' OR (estado='activo' AND clock_timestamp()<iniciado_at+make_interval(mins=>tiempo_limite))) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El tiempo de la sesión terminó.'; END IF;
  SELECT * INTO i FROM public.intentos WHERE id=p_intento FOR UPDATE;
  IF i.estado='finalizado' OR (i.vence_at IS NOT NULL AND clock_timestamp()>=i.vence_at) THEN RAISE EXCEPTION 'El intento ya terminó.'; END IF;
  caduca:=least(clock_timestamp()+interval '5 minutes',coalesce(i.vence_at,'infinity'::timestamptz));
  INSERT INTO app_private.codigos_reanudacion(intento_id,codigo_hash,vence_at)
    VALUES(i.id,encode(sha256(convert_to(codigo,'UTF8')),'hex'),caduca)
    ON CONFLICT(intento_id) DO UPDATE SET codigo_hash=EXCLUDED.codigo_hash,vence_at=EXCLUDED.vence_at,usado_at=NULL;
  IF coalesce(app_private.supervision_v3(i.id),false) THEN
    INSERT INTO public.incidencias_examen(intento_id,sesion_id,actor_id,tipo,detalle) VALUES(i.id,i.sesion_id,auth.uid(),'autorizacion','El moderador emitió un código personal de recuperación; vence en un máximo de cinco minutos.');
  END IF;
  RETURN jsonb_build_object('codigo',codigo,'vence_at',caduca);
END; $$;

CREATE OR REPLACE FUNCTION app_private.admin_examen_autorizar(p_intento uuid,p_justificacion text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.intentos; c app_private.control_intentos;
BEGIN

 IF length(btrim(p_justificacion)) NOT BETWEEN 5 AND 500 OR p_justificacion IS NULL THEN RAISE EXCEPTION 'Indica el motivo de la autorización.'; END IF;
 SELECT * INTO i FROM public.intentos WHERE id=p_intento;
 IF NOT app_private.es_admin() AND NOT app_private.puede_moderar(i.sesion_id) THEN
   RAISE EXCEPTION 'No tienes acceso a esta sesión.' USING ERRCODE='42501';
 END IF;
 PERFORM 1 FROM public.etapas WHERE id=i.etapa_id AND app_private.etapa_admite_examen(id) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'La etapa no admite acceso.'; END IF;
 PERFORM 1 FROM public.sesiones WHERE id=i.sesion_id AND eliminada_at IS NULL AND (estado='esperando' OR (estado='activo' AND clock_timestamp()<iniciado_at+make_interval(mins=>tiempo_limite))) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'La evaluación ya finalizó.'; END IF;
 SELECT * INTO i FROM public.intentos WHERE id=p_intento FOR UPDATE;
 IF i.estado='finalizado' OR i.vence_at<=clock_timestamp() THEN RAISE EXCEPTION 'La evaluación ya finalizó.'; END IF;
 SELECT * INTO c FROM app_private.control_intentos WHERE intento_id=i.id FOR UPDATE;
 IF c.solicitante IS NULL THEN RAISE EXCEPTION 'El joven debe abrir el examen y solicitar acceso.'; END IF;
 PERFORM app_private.cerrar_supervision_revisada(i.id);
 UPDATE app_private.control_intentos SET instancia=solicitante,requiere_aprobacion=false,ultimo_contacto=clock_timestamp(),oculto_desde=NULL,motivo='Reingreso autorizado',justificacion=p_justificacion WHERE intento_id=i.id;
 PERFORM app_private.examen_iniciar(i.id);
 INSERT INTO public.incidencias_examen(intento_id,sesion_id,actor_id,tipo,detalle) VALUES(i.id,i.sesion_id,auth.uid(),'autorizacion',p_justificacion);
 RETURN jsonb_build_object('autorizado',true);
END; $$;

CREATE OR REPLACE FUNCTION app_private.admin_examen_atender_ayuda(p_solicitud uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.incidencias_examen;
BEGIN
  IF NOT app_private.es_admin() AND NOT app_private.puede_moderar((SELECT sesion_id FROM public.incidencias_examen WHERE id=p_solicitud AND tipo='ayuda')) THEN
   RAISE EXCEPTION 'No tienes acceso a esta sesión.' USING ERRCODE='42501';
 END IF;
  SELECT * INTO a FROM public.incidencias_examen WHERE id=p_solicitud AND tipo='ayuda' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró esta solicitud.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.incidencias_examen WHERE intento_id=a.intento_id AND tipo='ayuda_atendida' AND detalle=a.id::text) THEN
    INSERT INTO public.incidencias_examen(intento_id,sesion_id,actor_id,tipo,detalle) VALUES(a.intento_id,a.sesion_id,auth.uid(),'ayuda_atendida',a.id::text);
  END IF;
  RETURN jsonb_build_object('atendida',true);
END; $$;

CREATE OR REPLACE FUNCTION app_private.preparar_banco_sesion(p_sesion uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.sesiones; e public.etapas; t text; n integer;
BEGIN
 IF NOT app_private.es_admin() AND NOT (pg_trigger_depth() > 0 AND app_private.puede_moderar(p_sesion)) THEN RAISE EXCEPTION 'No tienes acceso a esta sesión.' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM public.sesiones WHERE id=p_sesion AND eliminada_at IS NULL;
 SELECT * INTO e FROM public.etapas WHERE id=s.etapa_id;
 IF s.id IS NULL OR s.estado<>'esperando' OR NOT app_private.etapa_admite_examen(e.id) THEN RAISE EXCEPTION 'Esta sesión no admite iniciar el examen.'; END IF;
 IF EXISTS(SELECT 1 FROM app_private.banco_sesion WHERE sesion_id=s.id) THEN RAISE EXCEPTION 'El banco de esta sesión ya fue preparado.'; END IF;
 -- Una sola lectura obtiene una versión coherente del banco. Los que llegan tarde usan esta misma copia.
 INSERT INTO app_private.banco_sesion(sesion_id,pregunta_id,tipo,texto,opciones,respuesta_correcta,puntaje,rubrica)
 SELECT s.id,q.id,q.tipo,q.texto,q.opciones,q.respuesta_correcta,q.puntaje,q.rubrica
 FROM public.preguntas q WHERE q.etapa_id=e.id AND q.activa AND q.puntaje=(e.reglas->'puntos'->>q.tipo)::int;
 FOREACH t IN ARRAY ARRAY['multiple','abierta','contexto'] LOOP
  n:=(coalesce(s.distribucion,app_private.distribucion_examen(s.cantidad_preguntas))->>t)::int;
  IF n IS NULL OR (SELECT count(*) FROM app_private.banco_sesion WHERE sesion_id=s.id AND tipo=t)<n THEN
   RAISE EXCEPTION 'Faltan preguntas revisadas de tipo % para esta sesión: se requieren %.',t,n;
  END IF;
 END LOOP;
END; $$;

CREATE OR REPLACE FUNCTION app_private.examen_sincronizar_sesion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE i record;
BEGIN
  IF NOT app_private.es_admin() AND NOT (NOT (SELECT historica FROM public.etapas WHERE id=OLD.etapa_id) AND OLD.estado IN ('esperando','activo') AND app_private.moderacion_asignada(OLD.id)) THEN RAISE EXCEPTION 'No tienes acceso a esta sesión.' USING ERRCODE='42501'; END IF;
  IF NEW.estado=OLD.estado OR (SELECT historica FROM public.etapas WHERE id=NEW.etapa_id) THEN RETURN NEW; END IF;
  FOR i IN SELECT id FROM public.intentos WHERE sesion_id=NEW.id AND estado<>'finalizado' ORDER BY id LOOP
    IF NEW.estado='activo' THEN PERFORM app_private.examen_iniciar(i.id);
    ELSIF NEW.estado='finalizado' THEN PERFORM app_private.examen_cerrar(i.id,'cierre_sesion'); END IF;
  END LOOP;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION app_private.examen_recuperar(p_sesion uuid,p_codigo text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE c app_private.codigos_reanudacion; i public.intentos;
BEGIN
  PERFORM app_private.examen_uid();
  SELECT * INTO c FROM app_private.codigos_reanudacion WHERE codigo_hash=encode(sha256(convert_to(upper(replace(btrim(p_codigo),' ','')),'UTF8')),'hex');
  SELECT * INTO i FROM public.intentos WHERE id=c.intento_id AND sesion_id=p_sesion;
  IF i.id IS NULL THEN RAISE EXCEPTION 'Código inválido o vencido.' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.etapas WHERE id=i.etapa_id AND app_private.etapa_admite_examen(id) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Código inválido o vencido.' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.sesiones WHERE id=i.sesion_id AND eliminada_at IS NULL
    AND (estado='esperando' OR (estado='activo' AND clock_timestamp()<iniciado_at+make_interval(mins=>tiempo_limite))) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La sesión ya finalizó o no está disponible.' USING ERRCODE='42501'; END IF;
  SELECT * INTO i FROM public.intentos WHERE id=i.id FOR UPDATE;
  SELECT * INTO c FROM app_private.codigos_reanudacion WHERE id=c.id FOR UPDATE;
  IF c.usado_at IS NOT NULL OR c.vence_at<=clock_timestamp() OR i.estado='finalizado' THEN RAISE EXCEPTION 'Código inválido o vencido.' USING ERRCODE='42501'; END IF;
  IF coalesce(app_private.supervision_v3(i.id),false) AND EXISTS(SELECT 1 FROM public.intentos x JOIN public.sesiones z ON z.id=x.sesion_id WHERE z.eliminada_at IS NULL AND x.etapa_id=i.etapa_id AND x.usuario_id=auth.uid() AND x.id<>i.id) THEN RAISE EXCEPTION 'Este dispositivo ya tiene otra evaluación en la etapa.' USING ERRCODE='42501'; END IF;
  PERFORM app_private.cerrar_supervision_revisada(i.id);
  UPDATE public.intentos SET usuario_id=auth.uid() WHERE id=i.id;
  UPDATE app_private.codigos_reanudacion SET usado_at=clock_timestamp() WHERE id=c.id;
  IF coalesce(app_private.supervision_v3(i.id),false) THEN
    INSERT INTO app_private.control_intentos(intento_id,instancia,solicitante,ultimo_contacto,requiere_aprobacion,motivo)
    VALUES(i.id,app_private.instancia_examen(),app_private.instancia_examen(),clock_timestamp(),false,'Traslado autorizado')
    ON CONFLICT(intento_id) DO UPDATE SET instancia=EXCLUDED.instancia,solicitante=EXCLUDED.solicitante,ultimo_contacto=EXCLUDED.ultimo_contacto,requiere_aprobacion=false,oculto_desde=NULL,motivo=EXCLUDED.motivo;
    INSERT INTO public.incidencias_examen(intento_id,sesion_id,actor_id,tipo,detalle) VALUES(i.id,i.sesion_id,auth.uid(),'traslado','Código de recuperación del moderador consumido; acceso anterior revocado.');
  END IF;
  PERFORM app_private.examen_bloquear(i.id);
  RETURN app_private.examen_payload(i.id);
END; $$;

CREATE FUNCTION public.admin_moderacion_enlace(p_sesion uuid, p_revocar boolean) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT app_private.admin_moderacion_enlace($1,$2) $$;
REVOKE ALL ON FUNCTION public.admin_moderacion_enlace(uuid,boolean),app_private.admin_moderacion_enlace(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_moderacion_enlace(uuid,boolean),app_private.admin_moderacion_enlace(uuid,boolean) TO authenticated;

CREATE FUNCTION public.moderacion_entrar(p_sesion uuid, p_codigo text DEFAULT NULL) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT app_private.moderacion_entrar($1,$2) $$;
REVOKE ALL ON FUNCTION public.moderacion_entrar(uuid,text),app_private.moderacion_entrar(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.moderacion_entrar(uuid,text),app_private.moderacion_entrar(uuid,text) TO authenticated;

CREATE FUNCTION public.moderacion_estado(p_sesion uuid, p_estado text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT app_private.moderacion_estado($1,$2) $$;
REVOKE ALL ON FUNCTION public.moderacion_estado(uuid,text),app_private.moderacion_estado(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.moderacion_estado(uuid,text),app_private.moderacion_estado(uuid,text) TO authenticated;

CREATE FUNCTION public.moderacion_incidencias(p_intento uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT app_private.moderacion_incidencias($1) $$;
REVOKE ALL ON FUNCTION public.moderacion_incidencias(uuid),app_private.moderacion_incidencias(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.moderacion_incidencias(uuid),app_private.moderacion_incidencias(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION app_private.examen_contacto(p_intento uuid,p_accion text DEFAULT 'pulso',p_visible boolean DEFAULT true,p_motivo text DEFAULT '') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.intentos; c app_private.control_intentos; instancia uuid;
BEGIN
 i:=app_private.examen_bloquear(p_intento);
 IF NOT coalesce(app_private.supervision_v3(i.id),false) OR i.estado='finalizado' THEN RETURN app_private.examen_payload(i.id); END IF;
 instancia:=app_private.instancia_examen();
 INSERT INTO app_private.control_intentos(intento_id) VALUES(i.id) ON CONFLICT DO NOTHING;
 SELECT * INTO c FROM app_private.control_intentos WHERE intento_id=i.id FOR UPDATE;
 IF p_accion IS NULL OR p_accion NOT IN('pulso','salida','solicitar') OR length(p_motivo)>500 THEN RAISE EXCEPTION 'Acción de acceso inválida.'; END IF;
 IF p_accion='solicitar' THEN
  -- Un clic que llegó justo después de la aprobación no debe volver a bloquear al joven.
  IF c.instancia=instancia AND NOT c.requiere_aprobacion
    AND c.ultimo_contacto>=clock_timestamp()-interval '60 seconds'
    AND (c.oculto_desde IS NULL OR c.oculto_desde>=clock_timestamp()-interval '15 seconds')
    AND NOT app_private.supervision_pendiente(i.id) THEN
   RETURN app_private.examen_payload(i.id);
  END IF;
  IF c.solicitado_at IS NULL OR c.solicitado_at<clock_timestamp()-interval '30 seconds' THEN
   INSERT INTO public.incidencias_examen(intento_id,sesion_id,actor_id,tipo,detalle) VALUES(i.id,i.sesion_id,auth.uid(),'solicitud',coalesce(nullif(btrim(p_motivo),''),'Solicita continuar la evaluación'));
  END IF;
  UPDATE app_private.control_intentos SET requiere_aprobacion=true,solicitante=app_private.instancia_examen(),solicitado_at=clock_timestamp(),motivo=coalesce(nullif(btrim(p_motivo),''),'Solicita autorización') WHERE intento_id=i.id;
 ELSIF p_accion='salida' AND c.instancia=instancia THEN
  UPDATE app_private.control_intentos SET requiere_aprobacion=true,motivo='Salida de la página; requiere autorización' WHERE intento_id=i.id;
  INSERT INTO public.incidencias_examen(intento_id,sesion_id,actor_id,tipo,detalle) VALUES(i.id,i.sesion_id,auth.uid(),'salida','El navegador notificó una salida. La causa requiere revisión.');
 ELSIF c.instancia IS NULL OR c.instancia=instancia THEN
  UPDATE app_private.control_intentos SET instancia=app_private.instancia_examen(),solicitante=coalesce(solicitante,app_private.instancia_examen()),
   requiere_aprobacion=requiere_aprobacion OR (ultimo_contacto IS NOT NULL AND ultimo_contacto<clock_timestamp()-interval '60 seconds') OR (oculto_desde IS NOT NULL AND oculto_desde<clock_timestamp()-interval '15 seconds'),
   motivo=CASE WHEN ultimo_contacto<clock_timestamp()-interval '60 seconds' THEN 'Sin comunicación durante más de un minuto' WHEN oculto_desde<clock_timestamp()-interval '15 seconds' THEN 'Regreso tras una interrupción; requiere revisión' ELSE motivo END,
   ultimo_contacto=clock_timestamp(),oculto_desde=CASE WHEN p_visible THEN NULL ELSE coalesce(oculto_desde,clock_timestamp()) END
  WHERE intento_id=i.id;
 END IF;
 IF app_private.supervision_pendiente(i.id) THEN UPDATE app_private.control_intentos SET requiere_aprobacion=true,motivo='Interrupción sostenida de la vista del examen; el moderador debe revisar la causa.' WHERE intento_id=i.id; END IF;
 RETURN app_private.examen_payload(i.id);
END; $$;

NOTIFY pgrst,'reload schema';
COMMIT;
