-- ════════════════════════════════════════════════
-- 🎯 ROLE CONSTRAINT UPDATE (Outfit Contest)
-- ════════════════════════════════════════════════
-- Update the existing constraint to allow 'active' and 'locked' 
-- which are used to control the state of the outfit contest.
ALTER TABLE roles DROP CONSTRAINT roles_role_check;
ALTER TABLE roles ADD CONSTRAINT roles_role_check CHECK (role IN ('admin', 'waiter', 'valet', 'active', 'locked'));

-- ════════════════════════════════════════════════
-- 📸 MEMORY WALL & SOCIAL FEATURES (New Tables)
-- ════════════════════════════════════════════════

-- 1. Dedicated Gallery Table
CREATE TABLE IF NOT EXISTS public.gallery_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_phone TEXT REFERENCES public.guests(phone) ON DELETE CASCADE,
  photo_url TEXT NOT NULL,
  message TEXT,
  likes_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Likes Tracking
CREATE TABLE IF NOT EXISTS public.likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_phone TEXT NOT NULL,
  target_id TEXT NOT NULL, -- UUID for posts, Phone for outfits
  target_type TEXT CHECK (target_type IN ('gallery', 'outfit')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_phone, target_id)
);

-- 3. Enable RLS & Policies for new tables
ALTER TABLE public.gallery_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.likes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow All" ON public.gallery_posts FOR ALL USING (true);
CREATE POLICY "Allow All" ON public.likes FOR ALL USING (true);

-- 4. Enable Realtime for new tables
ALTER PUBLICATION supabase_realtime ADD TABLE gallery_posts;
ALTER PUBLICATION supabase_realtime ADD TABLE likes;

-- 5. Add keys for joining
ALTER TABLE public.likes ADD CONSTRAINT likes_user_phone_fkey FOREIGN KEY (user_phone) REFERENCES public.guests(phone) ON DELETE CASCADE;


-- ════════════════════════════════════════
-- UPDATE STORAGE POLICIES (Supabase Storage)
-- ════════════════════════════════════════
-- We need to replace the existing policies to include the new 'event-gallery' bucket.
-- Ensure you manually create the 'event-gallery' bucket in your Supabase dashboard first!

DROP POLICY IF EXISTS "Public Read" ON storage.objects;
CREATE POLICY "Public Read" ON storage.objects FOR SELECT USING (bucket_id IN ('family-photos', 'outfits', 'event-gallery'));

DROP POLICY IF EXISTS "Public Upload" ON storage.objects;
CREATE POLICY "Public Upload" ON storage.objects FOR INSERT WITH CHECK (bucket_id IN ('family-photos', 'outfits', 'event-gallery'));

DROP POLICY IF EXISTS "Public Update" ON storage.objects;
CREATE POLICY "Public Update" ON storage.objects FOR UPDATE USING (bucket_id IN ('family-photos', 'outfits', 'event-gallery'));

-- ════════════════════════════════════════
-- SOCIAL SQL FUNCTIONS (RPC)
-- ════════════════════════════════════════
-- These functions handle incrementing and decrementing likes and votes safely.

CREATE OR REPLACE FUNCTION increment_gallery_likes(post_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE public.gallery_posts
  SET likes_count = likes_count + 1
  WHERE id = post_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION decrement_gallery_likes(post_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE public.gallery_posts
  SET likes_count = GREATEST(0, likes_count - 1)
  WHERE id = post_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION increment_guest_votes(guest_phone TEXT)
RETURNS void AS $$
BEGIN
  UPDATE public.guests
  SET votes = COALESCE(votes, 0) + 1
  WHERE phone = guest_phone;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION decrement_guest_votes(guest_phone TEXT)
RETURNS void AS $$
BEGIN
  UPDATE public.guests
  SET votes = GREATEST(0, COALESCE(votes, 0) - 1)
  WHERE phone = guest_phone;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ════════════════════════════════════════
-- UPDATE ROLES SCHEMA
-- ════════════════════════════════════════
-- Add name tracking to staff roles
ALTER TABLE roles ADD COLUMN IF NOT EXISTS name TEXT;

-- ════════════════════════════════════════
-- 💬 GALLERY COMMENTS TABLE
-- ════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID REFERENCES public.gallery_posts(id) ON DELETE CASCADE,
  guest_phone TEXT REFERENCES public.guests(phone) ON DELETE CASCADE,
  parent_id UUID REFERENCES public.comments(id) ON DELETE CASCADE, -- Enable threading
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comments_parent ON public.comments(parent_id);


-- Add comments_count to gallery_posts for IG-style numbers on grid
ALTER TABLE public.gallery_posts ADD COLUMN IF NOT EXISTS comments_count INTEGER DEFAULT 0;

-- ════════════════════════════════════════
-- AUTOMATIC COUNT TRIGGERS
-- ════════════════════════════════════════

-- 1. Comment Count Trigger
CREATE OR REPLACE FUNCTION update_comment_count()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'INSERT') THEN
        UPDATE public.gallery_posts SET comments_count = comments_count + 1 WHERE id = NEW.post_id;
    ELSIF (TG_OP = 'DELETE') THEN
        UPDATE public.gallery_posts SET comments_count = GREATEST(0, comments_count - 1) WHERE id = OLD.post_id;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_update_comment_count
AFTER INSERT OR DELETE ON public.comments
FOR EACH ROW EXECUTE FUNCTION update_comment_count();

-- 2. Like Count Trigger (For Gallery Posts)
CREATE OR REPLACE FUNCTION update_like_count()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'INSERT' AND NEW.target_type = 'gallery') THEN
        UPDATE public.gallery_posts SET likes_count = likes_count + 1 WHERE id = NEW.target_id::uuid;
    ELSIF (TG_OP = 'DELETE' AND OLD.target_type = 'gallery') THEN
        UPDATE public.gallery_posts SET likes_count = GREATEST(0, likes_count - 1) WHERE id = OLD.target_id::uuid;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_update_like_count
AFTER INSERT OR DELETE ON public.likes
FOR EACH ROW EXECUTE FUNCTION update_like_count();

-- ════════════════════════════════════════
-- 3. INITIALIZE EXISTING COUNTS (One-time)
-- ════════════════════════════════════════
UPDATE public.gallery_posts p
SET 
  likes_count = (SELECT count(*) FROM public.likes l WHERE l.target_id::uuid = p.id AND l.target_type = 'gallery'),
  comments_count = (SELECT count(*) FROM public.comments c WHERE c.post_id = p.id);


ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow All Comments" ON public.comments FOR ALL USING (true);
ALTER PUBLICATION supabase_realtime ADD TABLE comments;
