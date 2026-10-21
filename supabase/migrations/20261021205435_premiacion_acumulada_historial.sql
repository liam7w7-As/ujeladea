-- Resumen derivado de Hebreos con sus reglas V1. No modifica tablas ni archivo originales.
BEGIN;
CREATE TABLE app_private.resultados_hebreos (
  etapa_id uuid PRIMARY KEY REFERENCES public.etapas(id) ON DELETE RESTRICT,
  archivo_md5 text NOT NULL,
  capturado_at timestamptz NOT NULL DEFAULT now(),
  contenido jsonb NOT NULL
);
CREATE TABLE app_private.validacion_pdf_hebreos (
  etapa_id uuid PRIMARY KEY REFERENCES app_private.resultados_hebreos(etapa_id) ON DELETE RESTRICT,
  pdf_sha256 text NOT NULL CHECK(pdf_sha256 ~ '^[a-f0-9]{64}$'),
  nota text NOT NULL CHECK(length(btrim(nota)) BETWEEN 10 AND 500),
  actor uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app_private.vinculos_premiacion (
  participante_efesios uuid PRIMARY KEY REFERENCES public.participantes(id) ON DELETE RESTRICT,
  participante_hebreos uuid UNIQUE REFERENCES public.participantes(id) ON DELETE RESTRICT,
  revision integer NOT NULL CHECK(revision > 0),
  motivo text NOT NULL,
  actor uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app_private.auditoria_premiacion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor uuid NOT NULL,
  tipo text NOT NULL,
  detalle jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app_private.resultados_hebreos ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.validacion_pdf_hebreos ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.vinculos_premiacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.auditoria_premiacion ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.resultados_hebreos,app_private.validacion_pdf_hebreos,
 app_private.vinculos_premiacion,app_private.auditoria_premiacion FROM PUBLIC,anon,authenticated;
CREATE TRIGGER resumen_hebreos_inmutable BEFORE UPDATE OR DELETE ON app_private.resultados_hebreos FOR EACH ROW EXECUTE FUNCTION app_private.archivo_inmutable();
CREATE TRIGGER validacion_hebreos_inmutable BEFORE UPDATE OR DELETE ON app_private.validacion_pdf_hebreos FOR EACH ROW EXECUTE FUNCTION app_private.archivo_inmutable();
CREATE TRIGGER auditoria_premiacion_inmutable BEFORE UPDATE OR DELETE ON app_private.auditoria_premiacion FOR EACH ROW EXECUTE FUNCTION app_private.archivo_inmutable();

DO $$
DECLARE eid uuid; d jsonb; firma text; jovenes jsonb; grupos jsonb;
BEGIN
 SELECT e.id,a.contenido->'datos',md5(a.contenido::text) INTO eid,d,firma
 FROM public.etapas e JOIN public.archivos_etapa a ON a.etapa_id=e.id WHERE e.codigo='2026-01-hebreos';
 IF eid IS NULL THEN RAISE EXCEPTION 'Falta el archivo original de Hebreos'; END IF;
 WITH preguntas AS (
   SELECT * FROM jsonb_to_recordset(d->'preguntas') AS x(id uuid,puntaje numeric)
 ), respuestas AS (
   SELECT * FROM jsonb_to_recordset(d->'respuestas') AS x(participante_id uuid,pregunta_id uuid,puntaje_obtenido numeric,calificado_por text)
 ), resumen AS (
   SELECT r.participante_id,sum(coalesce(r.puntaje_obtenido,0)) puntos_respuestas,sum(coalesce(q.puntaje,0)) maximo,
    count(*) FILTER(WHERE r.calificado_por='pendiente_ia' OR r.puntaje_obtenido IS NULL) pendientes
   FROM respuestas r LEFT JOIN preguntas q ON q.id=r.pregunta_id GROUP BY r.participante_id
 ), participantes AS (
   SELECT * FROM jsonb_to_recordset(d->'participantes') AS x(id uuid,sesion_id uuid,nombre text,puntaje_total numeric)
 ), sesiones AS (
   SELECT * FROM jsonb_to_recordset(d->'sesiones') AS x(id uuid,sociedad_id uuid,estado text)
 ), sociedades AS (
   SELECT * FROM jsonb_to_recordset(d->'sociedades') AS x(id uuid,nombre text,iglesia text)
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',p.id,'sesionId',p.sesion_id,'sociedadId',s.sociedad_id,'nombre',p.nombre,
   'sociedad',soc.nombre,'iglesia',soc.iglesia,'puntaje',coalesce(p.puntaje_total,0),
   'puntajeMax',coalesce(r.maximo,0),'puntosRespuestas',coalesce(r.puntos_respuestas,0),
   'pendientes',coalesce(r.pendientes,0),
   'nota',CASE WHEN r.maximo>0 THEN least(100,round(coalesce(p.puntaje_total,0)/r.maximo*100)) ELSE 0 END
 ) ORDER BY p.id),'[]'::jsonb) INTO jovenes
 FROM participantes p JOIN sesiones s ON s.id=p.sesion_id AND s.estado='finalizado'
 LEFT JOIN sociedades soc ON soc.id=s.sociedad_id LEFT JOIN resumen r ON r.participante_id=p.id;

 WITH personas AS (
   SELECT * FROM jsonb_to_recordset(jovenes) AS x("sesionId" uuid,"sociedadId" uuid,sociedad text,iglesia text,puntaje numeric,"puntajeMax" numeric,"puntosRespuestas" numeric,pendientes integer)
 ), eventos AS (
   SELECT * FROM jsonb_to_recordset(d->'eventos_sesion') AS x(sesion_id uuid)
 ), totales AS (
   SELECT p."sesionId" sesion_id,p."sociedadId" sociedad_id,max(p.sociedad) sociedad,max(p.iglesia) iglesia,
    count(*) rindieron,sum(p.puntaje) suma_notas,sum(p."puntosRespuestas") puntos,sum(p."puntajeMax") maximo,sum(p.pendientes) pendientes,
    (SELECT count(*) FROM eventos ev WHERE ev.sesion_id=p."sesionId") alertas
   FROM personas p GROUP BY p."sesionId",p."sociedadId"
 ), calculo AS (
   SELECT *,CASE WHEN maximo>0 THEN round(puntos/maximo*100) ELSE 0 END bruto,
    CASE WHEN alertas>=40 THEN 15 WHEN alertas>=30 THEN 10 WHEN alertas>=20 THEN 5 ELSE 0 END penalizacion,
    round(suma_notas/rindieron,1) promedio FROM totales
 ), posiciones AS (
   SELECT *,greatest(0,bruto-penalizacion) nota,
    row_number() OVER(ORDER BY greatest(0,bruto-penalizacion) DESC,promedio DESC,alertas,sesion_id) posicion FROM calculo
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'sesionId',sesion_id,'sociedadId',sociedad_id,'sociedad',sociedad,'iglesia',iglesia,
   'rindieron',rindieron,'puntajeObtenido',puntos,'puntajeMaximo',maximo,
   'pendientes',pendientes,'porcentajeBruto',bruto,'penalizacionPorcentaje',penalizacion,
   'promedioPorParticipante',promedio,'totalAlertas',alertas,'nota',nota,'posicion',posicion
 ) ORDER BY posicion),'[]'::jsonb) INTO grupos FROM posiciones;
 INSERT INTO app_private.resultados_hebreos(etapa_id,archivo_md5,contenido)
 VALUES(eid,firma,jsonb_build_object('metodo','V1-adc9e97','sociedades',grupos,'participantes',jovenes));
END;
$$;

CREATE FUNCTION app_private.admin_premiacion_resumen() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h app_private.resultados_hebreos; v app_private.validacion_pdf_hebreos; e public.etapas;
BEGIN
 IF NOT app_private.es_admin() THEN RAISE EXCEPTION 'Solo administradores' USING ERRCODE='42501'; END IF;
 SELECT * INTO h FROM app_private.resultados_hebreos;
 IF h.archivo_md5 IS DISTINCT FROM (SELECT md5(contenido::text) FROM public.archivos_etapa WHERE etapa_id=h.etapa_id) THEN
   RAISE EXCEPTION 'El archivo de Hebreos no coincide con el resumen preservado'; END IF;
 SELECT * INTO v FROM app_private.validacion_pdf_hebreos WHERE etapa_id=h.etapa_id;
 SELECT * INTO e FROM public.etapas WHERE codigo='2026-02-efesios';
 RETURN jsonb_build_object('hebreos',h.contenido,'archivo_md5',h.archivo_md5,
   'validacion_pdf',CASE WHEN v.etapa_id IS NULL THEN NULL ELSE jsonb_build_object('sha256',v.pdf_sha256,'nota',v.nota,'fecha',v.created_at) END,
   'efesios',jsonb_build_object('id',e.id,'estado',e.estado),
   'vinculos',coalesce((SELECT jsonb_agg(jsonb_build_object('efesios',participante_efesios,'hebreos',participante_hebreos,'revision',revision,'motivo',motivo)) FROM app_private.vinculos_premiacion),'[]'::jsonb));
END;
$$;

CREATE FUNCTION app_private.admin_premiacion_validar_pdf(p_sha256 text,p_nota text,p_confirmar boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h app_private.resultados_hebreos;
BEGIN
 IF NOT app_private.es_admin() THEN RAISE EXCEPTION 'Solo administradores' USING ERRCODE='42501'; END IF;
 IF p_confirmar IS DISTINCT FROM true OR p_sha256 IS NULL OR p_sha256 !~ '^[a-f0-9]{64}$' OR p_nota IS NULL OR length(btrim(p_nota)) NOT BETWEEN 10 AND 500 THEN
   RAISE EXCEPTION 'Confirma la comparación manual con el PDF original y registra una observación'; END IF;
 SELECT * INTO h FROM app_private.resultados_hebreos FOR UPDATE;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(h.contenido->'participantes') p WHERE (p->>'pendientes')::integer>0) THEN
   RAISE EXCEPTION 'Hebreos todavía conserva calificaciones pendientes'; END IF;
 IF EXISTS(SELECT 1 FROM app_private.validacion_pdf_hebreos WHERE etapa_id=h.etapa_id) THEN
   RAISE EXCEPTION 'La validación original ya está registrada y no puede sustituirse'; END IF;
 INSERT INTO app_private.validacion_pdf_hebreos(etapa_id,pdf_sha256,nota,actor) VALUES(h.etapa_id,p_sha256,btrim(p_nota),auth.uid());
 INSERT INTO app_private.auditoria_premiacion(actor,tipo,detalle) VALUES(auth.uid(),'validacion_pdf',jsonb_build_object('sha256',p_sha256,'nota',btrim(p_nota)));
 RETURN app_private.admin_premiacion_resumen();
END;
$$;

CREATE FUNCTION app_private.admin_premiacion_vincular(p_efesios uuid,p_hebreos uuid,p_motivo text,p_revision integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE revision_actual integer;
BEGIN
 IF NOT app_private.es_admin() THEN RAISE EXCEPTION 'Solo administradores' USING ERRCODE='42501'; END IF;
 IF p_motivo IS NULL OR length(btrim(p_motivo)) NOT BETWEEN 10 AND 500 THEN RAISE EXCEPTION 'Registra cómo verificaste la identidad'; END IF;
 PERFORM p.id FROM public.participantes p JOIN public.sesiones s ON s.id=p.sesion_id JOIN public.etapas e ON e.id=s.etapa_id
 WHERE p.id=p_efesios AND e.codigo='2026-02-efesios' FOR UPDATE OF p;
 IF NOT FOUND THEN RAISE EXCEPTION 'No corresponde a un participante de Efesios'; END IF;
 IF p_hebreos IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM app_private.resultados_hebreos h,jsonb_array_elements(h.contenido->'participantes') p WHERE p->>'id'=p_hebreos::text
 ) THEN RAISE EXCEPTION 'No corresponde a un participante de Hebreos'; END IF;
 SELECT revision INTO revision_actual FROM app_private.vinculos_premiacion WHERE participante_efesios=p_efesios FOR UPDATE;
 IF coalesce(revision_actual,0) IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Otro administrador cambió esta vinculación; actualiza la pantalla' USING ERRCODE='40001'; END IF;
 INSERT INTO app_private.vinculos_premiacion(participante_efesios,participante_hebreos,revision,motivo,actor)
 VALUES(p_efesios,p_hebreos,coalesce(revision_actual,0)+1,btrim(p_motivo),auth.uid())
 ON CONFLICT(participante_efesios) DO UPDATE SET participante_hebreos=EXCLUDED.participante_hebreos,
 revision=EXCLUDED.revision,motivo=EXCLUDED.motivo,actor=EXCLUDED.actor,updated_at=now();
 INSERT INTO app_private.auditoria_premiacion(actor,tipo,detalle)
 VALUES(auth.uid(),'identidad',jsonb_build_object('efesios',p_efesios,'hebreos',p_hebreos,'motivo',btrim(p_motivo),'revision',coalesce(revision_actual,0)+1));
 RETURN app_private.admin_premiacion_resumen();
END;
$$;

CREATE FUNCTION public.admin_premiacion_resumen() RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT app_private.admin_premiacion_resumen() $$;
CREATE FUNCTION public.admin_premiacion_validar_pdf(p_sha256 text,p_nota text,p_confirmar boolean) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT app_private.admin_premiacion_validar_pdf($1,$2,$3) $$;
CREATE FUNCTION public.admin_premiacion_vincular(p_efesios uuid,p_hebreos uuid,p_motivo text,p_revision integer DEFAULT 0) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT app_private.admin_premiacion_vincular($1,$2,$3,$4) $$;
REVOKE ALL ON FUNCTION public.admin_premiacion_resumen(),public.admin_premiacion_validar_pdf(text,text,boolean),public.admin_premiacion_vincular(uuid,uuid,text,integer),
 app_private.admin_premiacion_resumen(),app_private.admin_premiacion_validar_pdf(text,text,boolean),app_private.admin_premiacion_vincular(uuid,uuid,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_premiacion_resumen(),public.admin_premiacion_validar_pdf(text,text,boolean),public.admin_premiacion_vincular(uuid,uuid,text,integer),
 app_private.admin_premiacion_resumen(),app_private.admin_premiacion_validar_pdf(text,text,boolean),app_private.admin_premiacion_vincular(uuid,uuid,text,integer) TO authenticated;
COMMIT;
