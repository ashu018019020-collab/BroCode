CREATE OR REPLACE FUNCTION normalize_interview_interviewer_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.interviewer_id = 0 THEN
    NEW.interviewer_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_interview_interviewer_id ON interview;

CREATE TRIGGER trg_normalize_interview_interviewer_id
BEFORE INSERT OR UPDATE ON interview
FOR EACH ROW
EXECUTE FUNCTION normalize_interview_interviewer_id();
