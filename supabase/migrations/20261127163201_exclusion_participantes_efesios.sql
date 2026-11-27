BEGIN;

ALTER TABLE public.participantes
  ADD COLUMN excluido_resultados_at timestamptz,
  ADD COLUMN motivo_exclusion text,
  ADD CONSTRAINT participante_exclusion_completa CHECK (
    (excluido_resultados_at IS NULL AND motivo_exclusion IS NULL)
    OR (excluido_resultados_at IS NOT NULL AND motivo_exclusion IS NOT NULL
        AND length(btrim(motivo_exclusion)) BETWEEN 5 AND 500)
  );

CREATE FUNCTION app_private.proteger_exclusion_participante() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF current_user IN ('anon','authenticated','service_role') THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.excluido_resultados_at IS NOT NULL OR NEW.motivo_exclusion IS NOT NULL THEN
        RAISE EXCEPTION 'Usa la operación de exclusión de resultados.' USING ERRCODE='42501';
      END IF;
    ELSIF (NEW.excluido_resultados_at,NEW.motivo_exclusion)
      IS DISTINCT FROM (OLD.excluido_resultados_at,OLD.motivo_exclusion) THEN
      RAISE EXCEPTION 'Usa la operación de exclusión de resultados.' USING ERRCODE='42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app_private.proteger_exclusion_participante() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER proteger_exclusion_participante
  BEFORE INSERT OR UPDATE OF excluido_resultados_at,motivo_exclusion ON public.participantes
  FOR EACH ROW EXECUTE FUNCTION app_private.proteger_exclusion_participante();

CREATE FUNCTION app_private.admin_participante_exclusion(
  p_sesion uuid,p_participante uuid,p_excluir boolean,p_motivo text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  etapa_id_actual uuid;
  participante public.participantes;
  motivo text := btrim(p_motivo);
BEGIN
  IF NOT app_private.es_admin() THEN
    RAISE EXCEPTION 'Solo administradores.' USING ERRCODE='42501';
  END IF;
  IF p_excluir IS NULL OR motivo IS NULL OR length(motivo) NOT BETWEEN 5 AND 500 THEN
    RAISE EXCEPTION 'Escribe un motivo de entre 5 y 500 caracteres.';
  END IF;
  SELECT e.id INTO etapa_id_actual FROM public.etapas e JOIN public.sesiones s ON s.etapa_id=e.id
    WHERE s.id=p_sesion AND e.codigo='2026-02-efesios' AND NOT e.historica AND e.estado<>'cerrada'
    FOR UPDATE OF e;
  IF NOT FOUND THEN RAISE EXCEPTION 'Esta etapa no permite cambiar exclusiones.' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.sesiones s WHERE s.id=p_sesion AND s.etapa_id=etapa_id_actual
    AND s.estado='finalizado' AND s.eliminada_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solo se pueden revisar exclusiones en una sesión finalizada.' USING ERRCODE='42501'; END IF;
  SELECT p.* INTO participante FROM public.participantes p WHERE p.id=p_participante AND p.sesion_id=p_sesion FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El participante no pertenece a esta sesión.' USING ERRCODE='42501'; END IF;

  IF (participante.excluido_resultados_at IS NOT NULL) <> p_excluir THEN
    UPDATE public.participantes SET excluido_resultados_at=CASE WHEN p_excluir THEN clock_timestamp() END,
      motivo_exclusion=CASE WHEN p_excluir THEN motivo END
      WHERE id=participante.id RETURNING * INTO participante;

    INSERT INTO app_private.auditoria_premiacion(actor,tipo,detalle)
      VALUES(auth.uid(),'exclusion_participante',jsonb_build_object('sesion',p_sesion,'participante',p_participante,
        'excluido',p_excluir,'motivo',motivo));
  END IF;

  RETURN jsonb_build_object('excluido_resultados_at',participante.excluido_resultados_at,
    'motivo_exclusion',participante.motivo_exclusion);
END;
$$;

CREATE FUNCTION public.admin_participante_exclusion(
  p_sesion uuid,p_participante uuid,p_excluir boolean,p_motivo text
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT app_private.admin_participante_exclusion($1,$2,$3,$4)
$$;

REVOKE ALL ON FUNCTION public.admin_participante_exclusion(uuid,uuid,boolean,text),
  app_private.admin_participante_exclusion(uuid,uuid,boolean,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_participante_exclusion(uuid,uuid,boolean,text),
  app_private.admin_participante_exclusion(uuid,uuid,boolean,text) TO authenticated;

CREATE OR REPLACE FUNCTION app_private.validar_etapa() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.estado <> 'borrador' OR NEW.historica THEN
      RAISE EXCEPTION 'Las nuevas etapas deben crearse en borrador.';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.estado = 'cerrada' THEN RAISE EXCEPTION 'Una etapa cerrada no se puede modificar ni reabrir.'; END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.estado <> 'borrador' THEN RAISE EXCEPTION 'Solo se puede eliminar una etapa en borrador.'; END IF;
    RETURN OLD;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.historica IS DISTINCT FROM OLD.historica THEN
    RAISE EXCEPTION 'No se puede modificar la identidad o procedencia de una etapa.';
  END IF;
  IF OLD.estado = 'activa' AND coalesce((OLD.reglas->>'version')::int,2)<3 AND (NEW.libro, NEW.anio, NEW.numero, NEW.cantidad_preguntas, NEW.tiempo_limite, NEW.reglas)
    IS DISTINCT FROM (OLD.libro, OLD.anio, OLD.numero, OLD.cantidad_preguntas, OLD.tiempo_limite, OLD.reglas) THEN
    RAISE EXCEPTION 'La configuración del examen queda fija al activar la etapa.';
  END IF;
  IF coalesce((OLD.reglas->>'version')::int,2)>=3
    AND (NEW.libro,NEW.anio,NEW.numero,NEW.reglas-'distribucion') IS DISTINCT FROM (OLD.libro,OLD.anio,OLD.numero,OLD.reglas-'distribucion')
    AND EXISTS(SELECT 1 FROM public.sesiones WHERE etapa_id=OLD.id AND iniciado_at IS NOT NULL) THEN
    RAISE EXCEPTION 'La identidad y los criterios de la etapa quedan fijos tras iniciar una sesión.';
  END IF;
  IF OLD.estado = 'activa' AND NEW.estado = 'borrador' THEN
    RAISE EXCEPTION 'Una etapa activa no puede volver a borrador.';
  END IF;
  IF OLD.estado = 'borrador' AND NEW.estado = 'cerrada' AND coalesce((OLD.reglas->>'version')::int,2)<3 THEN
    RAISE EXCEPTION 'La etapa debe estar activa antes de cerrarla.';
  END IF;
  IF NEW.estado = 'activa' AND OLD.estado <> 'activa' THEN
    IF (SELECT count(*) FROM public.preguntas WHERE etapa_id = NEW.id AND activa) < NEW.cantidad_preguntas THEN
      RAISE EXCEPTION 'Faltan preguntas activas para iniciar esta etapa.';
    END IF;
  END IF;
  IF NEW.estado = 'cerrada' AND OLD.estado <> 'cerrada' THEN
    IF EXISTS (SELECT 1 FROM public.sesiones WHERE etapa_id = NEW.id AND eliminada_at IS NULL AND estado IS DISTINCT FROM 'finalizado') THEN
      RAISE EXCEPTION 'Finaliza todas las sesiones antes de cerrar la etapa.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.respuestas r JOIN public.participantes p ON p.id = r.participante_id
      JOIN public.sesiones s ON s.id = p.sesion_id WHERE s.etapa_id = NEW.id AND s.eliminada_at IS NULL
      AND p.excluido_resultados_at IS NULL
      AND (r.calificado_por = 'pendiente_ia' OR r.puntaje_obtenido IS NULL)) THEN
      RAISE EXCEPTION 'Hay respuestas pendientes de calificación.';
    END IF;
    NEW.cerrado_at := clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.admin_revision_resumen(p_sesion uuid,p_etapa uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.sesiones; resultado jsonb;
BEGIN
 s:=app_private.revision_sesion(p_sesion,p_etapa);
 SELECT jsonb_build_object('sesion_id',s.id,'etapa_id',s.etapa_id,'sociedad',(SELECT nombre FROM public.sociedades WHERE id=s.sociedad_id),
  'preguntas',coalesce(jsonb_agg(g ORDER BY g.texto,g.clave),'[]'::jsonb)) INTO resultado FROM (
   SELECT app_private.revision_grupo(q) clave,q.texto,q.respuesta_correcta referencia,q.rubrica,q.puntaje maximo,q.tipo,
    count(*) total,count(*) FILTER(WHERE r.calificado_por='pendiente_ia' OR r.puntaje_obtenido IS NULL) pendientes,
    count(*) FILTER(WHERE (r.calificado_por='pendiente_ia' OR r.puntaje_obtenido IS NULL) AND coalesce(m.consulta,false)) consultas,
    count(*) FILTER(WHERE r.calificado_por<>'pendiente_ia' AND r.puntaje_obtenido IS NOT NULL) revisadas
   FROM public.respuestas r JOIN public.intentos i ON i.id=r.intento_id JOIN public.intento_preguntas q ON q.id=r.intento_pregunta_id
   LEFT JOIN app_private.revision_jurado m ON m.respuesta_id=r.id
   WHERE i.sesion_id=s.id AND i.etapa_id=p_etapa AND q.tipo<>'multiple' AND EXISTS(SELECT 1 FROM public.participantes p WHERE p.id=r.participante_id AND p.excluido_resultados_at IS NULL)
   GROUP BY app_private.revision_grupo(q),q.texto,q.respuesta_correcta,q.rubrica,q.puntaje,q.tipo
  ) g;
 RETURN resultado;
END; $$;

CREATE OR REPLACE FUNCTION app_private.admin_revision_siguiente(p_sesion uuid,p_etapa uuid,p_grupo text,p_instancia uuid,p_modo text DEFAULT 'pendientes',p_excluir jsonb DEFAULT '[]') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.sesiones; candidato record; r public.respuestas; m app_private.revision_jurado; pendiente boolean;
BEGIN
 s:=app_private.revision_sesion(p_sesion,p_etapa);
 IF p_instancia IS NULL OR p_grupo IS NULL OR p_modo IS NULL OR p_modo NOT IN('pendientes','consulta','revisadas') OR jsonb_typeof(p_excluir) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Selecciona una pregunta y un modo de revisión.'; END IF;
 FOR candidato IN SELECT r0.id FROM public.respuestas r0 JOIN public.intentos i ON i.id=r0.intento_id JOIN public.intento_preguntas q ON q.id=r0.intento_pregunta_id
  LEFT JOIN app_private.revision_jurado m0 ON m0.respuesta_id=r0.id
  WHERE i.sesion_id=s.id AND i.etapa_id=p_etapa AND q.tipo<>'multiple' AND EXISTS(SELECT 1 FROM public.participantes p WHERE p.id=r0.participante_id AND p.excluido_resultados_at IS NULL) AND app_private.revision_grupo(q)=p_grupo AND NOT p_excluir ? r0.id::text
   AND CASE p_modo WHEN 'revisadas' THEN r0.calificado_por<>'pendiente_ia' AND r0.puntaje_obtenido IS NOT NULL
    WHEN 'consulta' THEN (r0.calificado_por='pendiente_ia' OR r0.puntaje_obtenido IS NULL) AND coalesce(m0.consulta,false)
    ELSE (r0.calificado_por='pendiente_ia' OR r0.puntaje_obtenido IS NULL) AND NOT coalesce(m0.consulta,false) END
   AND (m0.actor IS NULL OR m0.reserva_hasta<clock_timestamp() OR (m0.actor=auth.uid() AND m0.instancia=p_instancia))
  ORDER BY (m0.actor=auth.uid() AND m0.instancia=p_instancia) DESC NULLS LAST,r0.created_at,r0.id
 LOOP
  IF NOT pg_try_advisory_xact_lock(hashtextextended('revision:'||candidato.id::text,0)) THEN CONTINUE; END IF;
  SELECT r1.* INTO r FROM public.respuestas r1 JOIN public.participantes p ON p.id=r1.participante_id
    WHERE r1.id=candidato.id AND p.excluido_resultados_at IS NULL FOR SHARE OF p;
  IF NOT FOUND THEN CONTINUE; END IF;
  SELECT * INTO m FROM app_private.revision_jurado WHERE respuesta_id=r.id;
  IF m.actor IS NOT NULL AND m.reserva_hasta>=clock_timestamp() AND (m.actor<>auth.uid() OR m.instancia<>p_instancia) THEN CONTINUE; END IF;
  pendiente:=r.calificado_por='pendiente_ia' OR r.puntaje_obtenido IS NULL;
  IF (p_modo='revisadas' AND pendiente) OR (p_modo<>'revisadas' AND NOT pendiente) THEN CONTINUE; END IF;
  IF (p_modo='consulta' AND NOT coalesce(m.consulta,false)) OR (p_modo='pendientes' AND coalesce(m.consulta,false)) THEN CONTINUE; END IF;
  INSERT INTO app_private.revision_jurado(respuesta_id,actor,instancia,reserva_hasta,base_revision)
   VALUES(r.id,auth.uid(),p_instancia,clock_timestamp()+interval '90 seconds',r.revision_calificacion)
  ON CONFLICT(respuesta_id) DO UPDATE SET actor=auth.uid(),instancia=p_instancia,reserva_hasta=clock_timestamp()+interval '90 seconds';
  RETURN app_private.revision_dto(r.id);
 END LOOP;
 RETURN NULL;
END; $$;

CREATE OR REPLACE FUNCTION app_private.admin_revision_borrador(p_sesion uuid,p_etapa uuid,p_respuesta uuid,p_instancia uuid,p_revision integer,p_puntos jsonb,p_comentario text DEFAULT '',p_accion text DEFAULT 'guardar',p_motivo text DEFAULT '') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.respuestas; q public.intento_preguntas; m app_private.revision_jurado;
BEGIN
 PERFORM app_private.revision_sesion(p_sesion,p_etapa);
 PERFORM pg_advisory_xact_lock(hashtextextended('revision:'||p_respuesta::text,0));
 SELECT x.* INTO r FROM public.respuestas x JOIN public.intentos i ON i.id=x.intento_id WHERE x.id=p_respuesta AND i.sesion_id=p_sesion AND i.etapa_id=p_etapa AND EXISTS(SELECT 1 FROM public.participantes p WHERE p.id=x.participante_id AND p.excluido_resultados_at IS NULL);
 IF NOT FOUND THEN RAISE EXCEPTION 'La respuesta no pertenece a esta sesión.' USING ERRCODE='42501'; END IF;
 SELECT * INTO m FROM app_private.revision_jurado WHERE respuesta_id=r.id;
 IF p_instancia IS NULL OR m.actor IS DISTINCT FROM auth.uid() OR m.instancia IS DISTINCT FROM p_instancia THEN RAISE EXCEPTION 'Otra pantalla tiene reservada esta respuesta. Tus cambios locales se conservan.' USING ERRCODE='55P03'; END IF;
 IF p_revision IS NULL OR p_revision<>r.revision_calificacion THEN RAISE EXCEPTION 'La calificación cambió. Recarga antes de continuar.' USING ERRCODE='40001'; END IF;
 IF p_accion IS NULL OR p_accion NOT IN('guardar','pulso','liberar','consulta') OR p_comentario IS NULL OR length(p_comentario)>1500 OR p_motivo IS NULL OR length(p_motivo)>500 THEN RAISE EXCEPTION 'Revisa la solicitud de corrección.'; END IF;
 IF p_accion<>'pulso' THEN
  SELECT * INTO q FROM public.intento_preguntas WHERE id=r.intento_pregunta_id;
  IF q.tipo='multiple' THEN RAISE EXCEPTION 'Esta pregunta tiene corrección automática.'; END IF;
  PERFORM app_private.revision_puntos(q,p_puntos,true);
 END IF;
 IF p_accion='consulta' AND r.calificado_por<>'pendiente_ia' AND r.puntaje_obtenido IS NOT NULL THEN RAISE EXCEPTION 'Una nota guardada se modifica mediante segunda revisión.'; END IF;
 UPDATE app_private.revision_jurado SET
  puntos=CASE WHEN p_accion='pulso' THEN puntos ELSE p_puntos END,
  comentario=CASE WHEN p_accion='pulso' THEN comentario ELSE p_comentario END,base_revision=r.revision_calificacion,
  consulta=CASE WHEN p_accion='consulta' THEN true ELSE consulta END,
  motivo_consulta=CASE WHEN p_accion='pulso' THEN motivo_consulta ELSE p_motivo END,
  actor=CASE WHEN p_accion IN('consulta','liberar') THEN NULL ELSE actor END,
  instancia=CASE WHEN p_accion IN('consulta','liberar') THEN NULL ELSE instancia END,
  reserva_hasta=CASE WHEN p_accion IN('consulta','liberar') THEN NULL ELSE clock_timestamp()+interval '90 seconds' END,
  actualizado_at=clock_timestamp() WHERE respuesta_id=r.id;
 RETURN jsonb_build_object('guardado',true);
END; $$;

CREATE OR REPLACE FUNCTION app_private.admin_revision_guardar(p_sesion uuid,p_etapa uuid,p_respuesta uuid,p_instancia uuid,p_revision integer,p_puntos jsonb,p_comentario text,p_solicitud uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.respuestas; q public.intento_preguntas; m app_private.revision_jurado; resultado jsonb; huella text;
BEGIN
 IF NOT app_private.es_admin() THEN RAISE EXCEPTION 'Solo administradores.' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('revision:'||p_respuesta::text,0));
 SELECT x.* INTO r FROM public.respuestas x JOIN public.intentos i ON i.id=x.intento_id WHERE x.id=p_respuesta AND i.sesion_id=p_sesion AND i.etapa_id=p_etapa AND EXISTS(SELECT 1 FROM public.participantes p WHERE p.id=x.participante_id AND p.excluido_resultados_at IS NULL);
 IF NOT FOUND THEN RAISE EXCEPTION 'La respuesta no pertenece a esta sesión.' USING ERRCODE='42501'; END IF;
 SELECT * INTO m FROM app_private.revision_jurado WHERE respuesta_id=r.id;
 huella:=md5(jsonb_build_array(p_puntos,p_comentario,p_revision,p_instancia)::text);
 IF p_solicitud IS NOT NULL AND m.ultima_solicitud=p_solicitud AND m.ultimo_actor=auth.uid() THEN
  IF m.ultima_huella<>huella THEN RAISE EXCEPTION 'El envío ya registrado contiene otra revisión.'; END IF;
  RETURN m.ultimo_resultado;
 END IF;
 PERFORM app_private.revision_sesion(p_sesion,p_etapa);
 IF p_instancia IS NULL OR m.actor IS DISTINCT FROM auth.uid() OR m.instancia IS DISTINCT FROM p_instancia THEN RAISE EXCEPTION 'Otra pantalla tiene reservada esta respuesta.' USING ERRCODE='55P03'; END IF;
 IF p_solicitud IS NULL OR p_comentario IS NULL OR length(p_comentario)>1500 THEN RAISE EXCEPTION 'Revisa la confirmación de la calificación.'; END IF;
 SELECT * INTO q FROM public.intento_preguntas WHERE id=r.intento_pregunta_id;
 IF q.tipo='multiple' THEN RAISE EXCEPTION 'Esta pregunta tiene corrección automática.'; END IF;
 PERFORM app_private.revision_puntos(q,p_puntos,false);
 IF jsonb_array_length(q.rubrica)>0 THEN
  resultado:=app_private.admin_examen_calificar_rubrica(r.id,p_puntos,p_comentario,p_revision);
 ELSE
  IF p_revision IS NULL OR p_revision<>r.revision_calificacion THEN RAISE EXCEPTION 'Otra revisión cambió esta nota.' USING ERRCODE='40001'; END IF;
  resultado:=app_private.admin_examen_calificar(r.id,(p_puntos->>0)::int,'manual');
  UPDATE public.respuestas SET revision_calificacion=revision_calificacion+1 WHERE id=r.id;
 END IF;
 resultado:=resultado||jsonb_build_object('revision',r.revision_calificacion+1,'respuesta_id',r.id);
 UPDATE app_private.revision_jurado SET actor=NULL,instancia=NULL,reserva_hasta=NULL,puntos=NULL,comentario='',consulta=false,motivo_consulta='',
  ultima_solicitud=p_solicitud,ultima_huella=huella,ultimo_resultado=resultado,ultimo_actor=auth.uid(),actualizado_at=clock_timestamp() WHERE respuesta_id=r.id;
 RETURN resultado;
END; $$;

CREATE OR REPLACE FUNCTION app_private.admin_examen_contexto(p_respuesta uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.respuestas; q public.intento_preguntas; i public.intentos;
BEGIN
 IF NOT app_private.es_admin() THEN RAISE EXCEPTION 'Solo administradores.' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM public.respuestas WHERE id=p_respuesta AND EXISTS(SELECT 1 FROM public.participantes p WHERE p.id=respuestas.participante_id AND p.excluido_resultados_at IS NULL);
 SELECT * INTO q FROM public.intento_preguntas WHERE id=r.intento_pregunta_id;
 SELECT * INTO i FROM public.intentos WHERE id=r.intento_id;
 PERFORM app_private.revision_sesion(i.sesion_id,i.etapa_id);
 IF q.id IS NULL THEN RAISE EXCEPTION 'Esta respuesta no admite calificación en V2.'; END IF;
 RETURN jsonb_build_object('id',r.id,'texto',q.texto,'tipo',q.tipo,'referencia',q.respuesta_correcta,'maximo',q.puntaje,
  'respuesta',r.respuesta_dada,'rubrica',q.rubrica,'pendiente',r.calificado_por='pendiente_ia' OR r.puntaje_obtenido IS NULL,
  'revision',r.revision_calificacion,'etapa_id',i.etapa_id,'sesion_id',i.sesion_id);
END; $$;

CREATE OR REPLACE FUNCTION app_private.servicio_ia_reservar(p_respuesta uuid,p_revision integer,p_version text,p_reserva numeric) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e uuid; b app_private.ia_presupuestos; j app_private.ia_sugerencias; nuevo uuid:=gen_random_uuid();
BEGIN
 SELECT i.etapa_id INTO e FROM public.respuestas r JOIN public.intentos i ON i.id=r.intento_id
  JOIN public.intento_preguntas q ON q.id=r.intento_pregunta_id JOIN public.etapas t ON t.id=i.etapa_id
 WHERE r.id=p_respuesta AND r.revision_calificacion=p_revision AND (r.calificado_por='pendiente_ia' OR r.puntaje_obtenido IS NULL)
  AND EXISTS(SELECT 1 FROM public.sesiones s WHERE s.id=i.sesion_id AND s.eliminada_at IS NULL) AND q.tipo<>'multiple' AND EXISTS(SELECT 1 FROM public.participantes p WHERE p.id=r.participante_id AND p.excluido_resultados_at IS NULL) AND NOT t.historica AND t.estado<>'cerrada';
 IF e IS NULL THEN RAISE EXCEPTION 'La respuesta ya no admite sugerencias.' USING ERRCODE='40001'; END IF;
 IF p_version IS NULL OR length(p_version)>100 OR p_reserva IS NULL OR p_reserva<=0 OR p_reserva>0.25 THEN RAISE EXCEPTION 'Reserva de IA inválida.'; END IF;
 SELECT * INTO b FROM app_private.ia_presupuestos WHERE etapa_id=e FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'No hay presupuesto autorizado para esta etapa.' USING ERRCODE='42501'; END IF;
 SELECT * INTO j FROM app_private.ia_sugerencias WHERE respuesta_id=p_respuesta AND revision=p_revision AND version=p_version;
 IF j.estado='lista' THEN RETURN jsonb_build_object('estado','lista','resultado',j.resultado,'modelo',j.modelo,'disponible',greatest(0,b.limite-b.gastado-b.reservado)); END IF;
 IF j.estado='pendiente' THEN
  IF j.vence_at>clock_timestamp() THEN RETURN jsonb_build_object('estado','ocupada'); END IF;
  -- Un proceso interrumpido puede haber consumido: nunca se libera un coste desconocido.
  UPDATE app_private.ia_presupuestos SET reservado=reservado-j.reserva,gastado=gastado+j.reserva WHERE etapa_id=e RETURNING * INTO b;
  UPDATE app_private.ia_sugerencias SET costo=reserva,estimado=true,estado='fallida' WHERE respuesta_id=p_respuesta AND revision=p_revision AND version=p_version;
 END IF;
 p_reserva:=ceil(p_reserva*100000000)/100000000;
 IF b.gastado+b.reservado+p_reserva>b.limite THEN RETURN jsonb_build_object('estado','agotado','disponible',greatest(0,b.limite-b.gastado-b.reservado)); END IF;
 UPDATE app_private.ia_presupuestos SET reservado=reservado+p_reserva WHERE etapa_id=e;
 INSERT INTO app_private.ia_sugerencias(respuesta_id,revision,version,etapa_id,token,estado,reserva,vence_at)
 VALUES(p_respuesta,p_revision,p_version,e,nuevo,'pendiente',p_reserva,clock_timestamp()+interval '3 minutes')
 ON CONFLICT(respuesta_id,revision,version) DO UPDATE SET token=nuevo,estado='pendiente',reserva=p_reserva,costo=NULL,estimado=false,resultado=NULL,modelo=NULL,vence_at=excluded.vence_at;
 RETURN jsonb_build_object('estado','reservada','token',nuevo,'disponible',greatest(0,b.limite-b.gastado-b.reservado-p_reserva));
END; $$;

CREATE OR REPLACE FUNCTION app_private.admin_examen_calificar(p_respuesta uuid,p_puntaje integer,p_metodo text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE r public.respuestas; i public.intentos; q public.intento_preguntas;
BEGIN
  IF NOT app_private.es_admin() THEN RAISE EXCEPTION 'Solo administradores.' USING ERRCODE='42501'; END IF;
  SELECT * INTO r FROM public.respuestas WHERE id=p_respuesta;
  SELECT * INTO i FROM public.intentos WHERE id=r.intento_id;
  IF i.id IS NULL THEN RAISE EXCEPTION 'No se recalifican respuestas históricas.'; END IF;
  PERFORM 1 FROM public.etapas WHERE id=i.etapa_id AND estado<>'cerrada' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La etapa está cerrada.'; END IF;
  -- Serializar por participante evita perder sumas al calificar respuestas distintas en paralelo.
  PERFORM 1 FROM public.participantes WHERE id=i.participante_id AND excluido_resultados_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El intento está excluido de resultados.' USING ERRCODE='42501'; END IF;
  SELECT * INTO r FROM public.respuestas WHERE id=p_respuesta FOR UPDATE;
  SELECT * INTO q FROM public.intento_preguntas WHERE id=r.intento_pregunta_id;
  IF p_puntaje IS NULL OR p_puntaje<0 OR p_puntaje>q.puntaje OR p_metodo NOT IN ('manual','ia') OR p_metodo IS NULL OR q.tipo='multiple' THEN
    RAISE EXCEPTION 'Calificación inválida para esta respuesta.';
  END IF;
  IF coalesce(app_private.supervision_v3(i.id),false) AND current_setting('app.rubrica_validada',true) IS DISTINCT FROM r.id::text THEN RAISE EXCEPTION 'Califica mediante los criterios de la rúbrica.'; END IF;
  UPDATE public.respuestas SET puntaje_obtenido=p_puntaje,es_correcta=p_puntaje>0,calificado_por=p_metodo WHERE id=r.id;
  UPDATE public.participantes SET puntaje_total=(SELECT coalesce(sum(puntaje_obtenido),0) FROM public.respuestas WHERE intento_id=i.id)
    WHERE id=i.participante_id;
  RETURN jsonb_build_object('id',r.id,'puntaje',p_puntaje);
END; $$;

COMMIT;
