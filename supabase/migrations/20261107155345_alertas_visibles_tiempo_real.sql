-- Notifica al único panel de moderación mediante la tabla ya publicada en Realtime.
-- Un registro por episodio; los pulsos sin cambios no generan notificaciones extra.
BEGIN;
CREATE FUNCTION app_private.avisar_supervision_sala() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.senales='["pantalla_completa_no_disponible"]'::jsonb THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND NEW.hasta IS NOT DISTINCT FROM OLD.hasta
   AND NEW.requiere_revision IS NOT DISTINCT FROM OLD.requiere_revision
   AND NEW.senales IS NOT DISTINCT FROM OLD.senales THEN RETURN NEW; END IF;
 INSERT INTO public.eventos_sesion(participante_id,sesion_id,intento_id,solicitud_id,tipo,cantidad,ultimo_at)
 SELECT i.participante_id,i.sesion_id,i.id,NEW.episodio,'supervision_vista',1,clock_timestamp()
 FROM public.intentos i WHERE i.id=NEW.intento_id
 ON CONFLICT(intento_id,solicitud_id) WHERE intento_id IS NOT NULL DO UPDATE
 SET ultimo_at=EXCLUDED.ultimo_at WHERE public.eventos_sesion.tipo='supervision_vista';
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION app_private.avisar_supervision_sala() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER avisar_supervision_sala AFTER INSERT OR UPDATE ON app_private.episodios_supervision
 FOR EACH ROW EXECUTE FUNCTION app_private.avisar_supervision_sala();
COMMIT;
