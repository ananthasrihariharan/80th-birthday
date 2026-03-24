-- Add unique constraint to valet_requests to support upsert(onConflict: 'guest_phone')
-- and to ensure a guest can only have one active valet request at a time.

-- 1. First, identify and remove any potential duplicates (just in case)
-- We'll keep the most recent request for each guest phone.
DELETE FROM public.valet_requests
WHERE id NOT IN (
  SELECT DISTINCT ON (guest_phone) id
  FROM public.valet_requests
  ORDER BY guest_phone, created_at DESC
);

-- 2. Add the unique constraint
ALTER TABLE public.valet_requests 
ADD CONSTRAINT valet_requests_guest_phone_unique UNIQUE (guest_phone);
