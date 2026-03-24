-- 1. Create Dishes Table
CREATE TABLE dishes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  emoji TEXT DEFAULT '🥗',
  category TEXT NOT NULL,
  day INTEGER DEFAULT 1, -- 1 or 2
  session TEXT, -- 'Breakfast', 'Lunch', 'Dinner', 'Reception'
  created_at TIMESTAMPTZ DEFAULT now()
 );

-- 2. Create Roles Table (Staff Management)
CREATE TABLE roles (
  phone TEXT PRIMARY KEY,
  name TEXT,
  role TEXT CHECK (role IN ('admin', 'waiter', 'valet', 'active', 'locked')),
  added_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Create Guests Table
CREATE TABLE guests (
  phone TEXT PRIMARY KEY,
  id TEXT, -- For convenience matching phone
  name TEXT,
  members INTEGER,
  dishes JSONB DEFAULT '[]',
  completed BOOLEAN DEFAULT false,
  checked_in BOOLEAN DEFAULT false,
  assigned_waiter TEXT REFERENCES roles(phone),
  table_number TEXT,
  status TEXT DEFAULT 'active',
  registered_at TIMESTAMPTZ DEFAULT now(),
  allocated_at TIMESTAMPTZ,
  outfit_url TEXT,
  photo_url TEXT, 
  votes INTEGER DEFAULT 0, 
  fav_dish TEXT,
  menu_selections JSONB DEFAULT '{}' -- { "day1_breakfast": { "dishes": [], "fav": "" }, ... }
);

-- 4. Create Feedback Table
CREATE TABLE feedback (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT,
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  message TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Enable Row Level Security (RLS)
ALTER TABLE dishes ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE guests ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow All" ON dishes FOR ALL USING (true);
CREATE POLICY "Allow All" ON roles FOR ALL USING (true);
CREATE POLICY "Allow All" ON guests FOR ALL USING (true);
CREATE POLICY "Allow All" ON feedback FOR ALL USING (true);

-- 6. Enable Realtime for all tables
ALTER PUBLICATION supabase_realtime ADD TABLE guests;
ALTER PUBLICATION supabase_realtime ADD TABLE roles;
ALTER PUBLICATION supabase_realtime ADD TABLE dishes;
ALTER PUBLICATION supabase_realtime ADD TABLE feedback;

-- ════════════════════════════════════════
-- VALET PARKING EXTENSIONS (Merged from v2)
-- ════════════════════════════════════════

CREATE TABLE IF NOT EXISTS valet_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  guest_phone TEXT REFERENCES guests(phone),
  car_number TEXT NOT NULL,
  car_model TEXT NOT NULL,
  car_colour TEXT NOT NULL,
  arrival_time TEXT,
  notes TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'parked', 'pickup_requested', 'returned')),
  assigned_driver TEXT,
  parked_at TIMESTAMPTZ,
  returned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE valet_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow All" ON valet_requests FOR ALL USING (true);

-- Add valet_needed column to guests
ALTER TABLE guests ADD COLUMN IF NOT EXISTS valet_needed BOOLEAN DEFAULT false;

-- (Roles table constraint updated in the CREATE TABLE statement above)

-- Enable Realtime for valet
ALTER PUBLICATION supabase_realtime ADD TABLE valet_requests;

-- ════════════════════════════════════════
-- STORAGE POLICIES (Supabase Storage)
-- ════════════════════════════════════════
-- Note: These policies assume buckets 'family-photos' and 'outfits' exist.
-- They allow public (anon) uploads which is needed for the "Fast Login" flow.

-- Allow public access to read any file in these buckets
CREATE POLICY "Public Read" ON storage.objects FOR SELECT USING (bucket_id IN ('family-photos', 'outfits'));

-- Allow anyone to upload to these buckets (required for Fast Login without real auth)
CREATE POLICY "Public Upload" ON storage.objects FOR INSERT WITH CHECK (bucket_id IN ('family-photos', 'outfits'));

-- Allow users to update their own files (best effort check by filename)
CREATE POLICY "Public Update" ON storage.objects FOR UPDATE USING (bucket_id IN ('family-photos', 'outfits'));

-- ════════════════════════════════════════════════
-- 📸 MEMORY WALL & SOCIAL FEATURES
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

-- RLS & Policies
ALTER TABLE public.gallery_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.likes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow All" ON public.gallery_posts FOR ALL USING (true);
CREATE POLICY "Allow All" ON public.likes FOR ALL USING (true);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE gallery_posts;
ALTER PUBLICATION supabase_realtime ADD TABLE likes;

-- STORAGE BUCKETS (Manual)
-- 1. Create bucket: "event-gallery"
-- Policies: Public Read & Insert (Select bucket names updated)
ALTER POLICY "Public Read" ON storage.objects 
  USING (bucket_id IN ('family-photos', 'outfits', 'event-gallery'));

ALTER POLICY "Public Upload" ON storage.objects 
  WITH CHECK (bucket_id IN ('family-photos', 'outfits', 'event-gallery'));

ALTER POLICY "Public Update" ON storage.objects 
  USING (bucket_id IN ('family-photos', 'outfits', 'event-gallery'));

-- 3. Social SQL Functions (RPC)
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
