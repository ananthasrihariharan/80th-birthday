-- 1. Create Dishes Table
CREATE TABLE dishes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  emoji TEXT DEFAULT '🥗',
  category TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Create Roles Table (Staff Management)
CREATE TABLE roles (
  phone TEXT PRIMARY KEY,
  role TEXT CHECK (role IN ('admin', 'waiter')),
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
  photo_url TEXT, -- Missing column for family photo
  votes INTEGER DEFAULT 0, -- Missing column for contest
  fav_dish TEXT -- Missing column for special request
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
-- This is critical for the "no refresh" experience
ALTER PUBLICATION supabase_realtime ADD TABLE guests;
ALTER PUBLICATION supabase_realtime ADD TABLE roles;
ALTER PUBLICATION supabase_realtime ADD TABLE dishes;
ALTER PUBLICATION supabase_realtime ADD TABLE feedback;
