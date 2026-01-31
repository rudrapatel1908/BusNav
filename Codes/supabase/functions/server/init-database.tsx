/**
 * Database Initialization Script for BusNav
 * 
 * This script creates all necessary tables and seeds them with initial data.
 * Run this once to set up the database schema.
 * 
 * IMPORTANT: Execute these SQL statements in the Supabase SQL Editor
 * (https://supabase.com/dashboard/project/_/sql)
 */

export const DATABASE_SCHEMA = `
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- PROFILES TABLE (User accounts)
-- ============================================
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student', 'parent')),
  selected_university_id UUID,
  home_latitude DOUBLE PRECISION,
  home_longitude DOUBLE PRECISION,
  home_address TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create unique index on email (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_unique_idx ON profiles (LOWER(email));

-- Enable Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Policies: Users can only read/update their own profile
CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

-- Prevent users from changing their email or role
CREATE POLICY "Users cannot change email or role"
  ON profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (
    email = (SELECT email FROM profiles WHERE id = auth.uid()) AND
    role = (SELECT role FROM profiles WHERE id = auth.uid())
  );

-- ============================================
-- UNIVERSITIES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS universities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  location TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security (public read)
ALTER TABLE universities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view universities"
  ON universities FOR SELECT
  TO public
  USING (true);

-- ============================================
-- DRIVERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS drivers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  photo_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view drivers"
  ON drivers FOR SELECT
  TO public
  USING (true);

-- ============================================
-- BUSES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS buses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  university_id UUID NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
  driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  bus_number TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(university_id, bus_number)
);

ALTER TABLE buses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view buses"
  ON buses FOR SELECT
  TO public
  USING (true);

-- ============================================
-- BUS LOCATIONS TABLE (Real-time tracking)
-- ============================================
CREATE TABLE IF NOT EXISTS bus_locations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bus_id UUID UNIQUE NOT NULL REFERENCES buses(id) ON DELETE CASCADE,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE bus_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view bus locations"
  ON bus_locations FOR SELECT
  TO public
  USING (true);

-- ============================================
-- FEEDBACK TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS feedback (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view feedback"
  ON feedback FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Authenticated users can create feedback"
  ON feedback FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- ============================================
-- USER PICKUP ROUTES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS user_pickup_routes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID UNIQUE NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  bus_id UUID NOT NULL REFERENCES buses(id) ON DELETE CASCADE,
  pickup_latitude DOUBLE PRECISION NOT NULL,
  pickup_longitude DOUBLE PRECISION NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE user_pickup_routes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own pickup route"
  ON user_pickup_routes FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own pickup route"
  ON user_pickup_routes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can modify own pickup route"
  ON user_pickup_routes FOR UPDATE
  USING (auth.uid() = user_id);

-- ============================================
-- SEED DATA
-- ============================================

-- Insert Universities (15 major Indian universities)
INSERT INTO universities (name, short_name, location, latitude, longitude) VALUES
('Indian Institute of Technology Delhi', 'IIT Delhi', 'New Delhi', 28.5449, 77.1926),
('Indian Institute of Technology Bombay', 'IIT Bombay', 'Mumbai', 19.1334, 72.9133),
('Indian Institute of Technology Madras', 'IIT Madras', 'Chennai', 12.9916, 80.2336),
('Delhi University', 'DU', 'New Delhi', 28.6863, 77.2063),
('Jawaharlal Nehru University', 'JNU', 'New Delhi', 28.5430, 77.1670),
('University of Mumbai', 'MU', 'Mumbai', 19.0760, 72.8777),
('Anna University', 'AU', 'Chennai', 13.0115, 80.2336),
('Bangalore University', 'BU', 'Bangalore', 12.9716, 77.5946),
('Jadavpur University', 'JU', 'Kolkata', 22.4990, 88.3712),
('Pune University', 'SPPU', 'Pune', 18.5491, 73.8257),
('Hyderabad University', 'UoH', 'Hyderabad', 17.4590, 78.3280),
('Aligarh Muslim University', 'AMU', 'Aligarh', 27.8974, 78.0880),
('Banaras Hindu University', 'BHU', 'Varanasi', 25.2677, 82.9913),
('Calcutta University', 'CU', 'Kolkata', 22.5726, 88.3639),
('Jamia Millia Islamia', 'JMI', 'New Delhi', 28.5613, 77.2809)
ON CONFLICT DO NOTHING;

-- Get university IDs for reference
DO $$
DECLARE
  uni_id UUID;
  driver_id UUID;
  bus_id UUID;
  uni_record RECORD;
  driver_names TEXT[] := ARRAY[
    'Rajesh Kumar', 'Suresh Sharma', 'Amit Singh', 'Vijay Patel', 'Ravi Gupta', 'Manoj Yadav',
    'Sanjay Verma', 'Anil Kumar', 'Prakash Joshi', 'Ramesh Reddy', 'Dinesh Rao', 'Mukesh Malhotra',
    'Ashok Kumar', 'Deepak Singh', 'Rakesh Sharma', 'Santosh Yadav', 'Mohit Gupta', 'Vikas Patel',
    'Ajay Kumar', 'Nitin Verma', 'Sachin Jain', 'Rahul Singh', 'Kiran Kumar', 'Naveen Sharma',
    'Pankaj Yadav', 'Sumit Gupta', 'Arun Kumar', 'Vinod Singh', 'Lalit Sharma', 'Gopal Rao',
    'Manish Kumar', 'Praveen Patel', 'Yogesh Verma', 'Kamal Singh', 'Subhash Yadav', 'Hemant Gupta',
    'Bharat Kumar', 'Chetan Sharma', 'Jitendra Singh', 'Lokesh Patel', 'Narendra Yadav', 'Om Prakash',
    'Prem Kumar', 'Rajeev Singh', 'Shyam Sharma', 'Tarun Gupta', 'Uday Patel', 'Varun Verma',
    'Wasim Khan', 'Yashwant Kumar', 'Zaheer Ahmad', 'Akshay Singh', 'Brijesh Sharma', 'Chirag Patel',
    'Dilip Yadav', 'Eknath Gupta', 'Firoz Khan', 'Ganesh Kumar', 'Harish Singh', 'Imran Ahmad',
    'Jagdish Sharma', 'Kailash Patel', 'Laxman Yadav', 'Mahesh Gupta', 'Naresh Kumar', 'Omkar Singh',
    'Pradeep Sharma', 'Qadir Khan', 'Rajendra Patel', 'Sagar Yadav', 'Tushar Gupta', 'Umesh Kumar',
    'Vikram Singh', 'Wasim Akram', 'Xavier D''Souza', 'Yuvraj Sharma', 'Zafar Khan', 'Abdul Rahman',
    'Balaji Rao', 'Chandra Kumar', 'Dhananjay Singh', 'Eshwar Sharma', 'Farhan Khan', 'Gajendra Patel',
    'Hari Yadav', 'Irfan Ahmad', 'Jai Kumar', 'Keshav Singh'
  ];
  driver_counter INTEGER := 0;
BEGIN
  -- For each university, create 6 buses with drivers
  FOR uni_record IN SELECT id, short_name FROM universities LOOP
    FOR bus_num IN 1..6 LOOP
      driver_counter := driver_counter + 1;
      
      -- Create driver
      INSERT INTO drivers (name, phone, photo_url)
      VALUES (
        driver_names[driver_counter],
        '+91 ' || LPAD((9000000000 + driver_counter)::TEXT, 10, '0'),
        NULL
      )
      RETURNING id INTO driver_id;
      
      -- Create bus
      INSERT INTO buses (university_id, driver_id, bus_number)
      VALUES (
        uni_record.id,
        driver_id,
        uni_record.short_name || '-' || bus_num
      )
      RETURNING id INTO bus_id;
      
      -- Create initial bus location (near university with slight random offset)
      INSERT INTO bus_locations (bus_id, latitude, longitude)
      SELECT 
        bus_id,
        u.latitude + (RANDOM() * 0.02 - 0.01),
        u.longitude + (RANDOM() * 0.02 - 0.01)
      FROM universities u
      WHERE u.id = uni_record.id;
    END LOOP;
  END LOOP;
END $$;
`;

console.log('📋 Copy the SQL above and run it in your Supabase SQL Editor');
console.log('🔗 https://supabase.com/dashboard/project/_/sql');