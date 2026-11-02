-- Apply only with explicit operator approval, inside ONE transaction (psql -1).
-- No research evidence or checkpoint is rewritten. All writers, including older
-- workers, participate through triggers; application-only increments are unsafe.
LOCK TABLE research_shadow_tracking, research_shadow_candles, research_shadow_occurrences IN SHARE ROW EXCLUSIVE MODE;
CREATE SEQUENCE IF NOT EXISTS research_shadow_revision_seq AS bigint NO CYCLE;
ALTER TABLE research_shadow_tracking ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT nextval('research_shadow_revision_seq');

CREATE OR REPLACE FUNCTION research_shadow_tracking_revision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.revision := nextval('research_shadow_revision_seq');
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS research_shadow_tracking_revision ON research_shadow_tracking;
CREATE TRIGGER research_shadow_tracking_revision BEFORE INSERT OR UPDATE ON research_shadow_tracking
FOR EACH ROW EXECUTE FUNCTION research_shadow_tracking_revision();

CREATE OR REPLACE FUNCTION research_shadow_evidence_revision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    UPDATE research_shadow_tracking SET revision = revision;
  ELSE
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      UPDATE research_shadow_tracking SET revision = revision WHERE id = OLD.tracking_id;
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      UPDATE research_shadow_tracking SET revision = revision WHERE id = NEW.tracking_id;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS research_shadow_candles_revision ON research_shadow_candles;
CREATE TRIGGER research_shadow_candles_revision AFTER INSERT OR UPDATE OR DELETE ON research_shadow_candles
FOR EACH ROW EXECUTE FUNCTION research_shadow_evidence_revision();
DROP TRIGGER IF EXISTS research_shadow_occurrences_revision ON research_shadow_occurrences;
CREATE TRIGGER research_shadow_occurrences_revision AFTER INSERT OR UPDATE OR DELETE ON research_shadow_occurrences
FOR EACH ROW EXECUTE FUNCTION research_shadow_evidence_revision();
DROP TRIGGER IF EXISTS research_shadow_candles_truncate_revision ON research_shadow_candles;
CREATE TRIGGER research_shadow_candles_truncate_revision AFTER TRUNCATE ON research_shadow_candles
FOR EACH STATEMENT EXECUTE FUNCTION research_shadow_evidence_revision();
DROP TRIGGER IF EXISTS research_shadow_occurrences_truncate_revision ON research_shadow_occurrences;
CREATE TRIGGER research_shadow_occurrences_truncate_revision AFTER TRUNCATE ON research_shadow_occurrences
FOR EACH STATEMENT EXECUTE FUNCTION research_shadow_evidence_revision();
