-- Include the ML capstone evidence checklist in the existing ML sync payload.
--
-- The checklist lives under the exact key `mcap` (not `mmod:`) because it is one course-wide record:
-- `{ answer: '["Decision frame", "Baseline and metric", ...]' }`. Without this key the browser could
-- save section records but the capstone ticks stayed local, so a learner could complete every module
-- on one device and still fail the certificate check on another.
--
-- SAFETY. This only replaces the validator; no column, policy, grant, table or NumPy function is
-- touched. `mmod:` remains the only prefix, `mcap` is one exact key, every value must still be an
-- object, and the same 20 KB draft / 64 KB payload bound applies. The RPC and its identity-bound
-- caller remain unchanged. Apply with `npm run db:deploy`; never `migrate reset` or `db push`.

CREATE OR REPLACE FUNCTION public.checked_ml_per_course(input jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $function$
DECLARE
  payload jsonb := COALESCE(input, '{}'::jsonb);
BEGIN
  IF jsonb_typeof(payload) <> 'object' THEN
    RAISE EXCEPTION 'ml_per_course must be a JSON object.';
  END IF;
  IF octet_length(payload::text) > 65536 THEN
    RAISE EXCEPTION 'ml_per_course exceeds the payload limit.';
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(payload)) > 600 THEN
    RAISE EXCEPTION 'ml_per_course holds too many records.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_each(payload) AS entry(key, value)
    WHERE NOT (entry.key LIKE 'mmod:%' OR entry.key = 'mcap')
      OR jsonb_typeof(entry.value) <> 'object'
      OR (
        entry.value ? 'answer'
        AND (
          jsonb_typeof(entry.value -> 'answer') <> 'string'
          OR char_length(entry.value ->> 'answer') > 20000
        )
      )
  ) THEN
    RAISE EXCEPTION 'ml_per_course must hold only bounded mmod records and the mcap checklist.';
  END IF;
  RETURN payload;
END;
$function$;

REVOKE ALL ON FUNCTION public.checked_ml_per_course(jsonb) FROM PUBLIC, anon;
