-- NYC Building Violations App - PostgreSQL Schema with Firebase Auth
-- Firebase UID is used as the primary key for users (user_id TEXT)
-- This ensures all user-related queries use the Firebase UID as the identifier

-- ============================================================================
-- CORE TABLES (MVP - Week 1)
-- ============================================================================

-- Zip codes reference table
CREATE TABLE zip_codes (
  postcode TEXT PRIMARY KEY,
  borough TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Buildings (violations aggregated at building level)
CREATE TABLE buildings (
  building_id TEXT PRIMARY KEY,
  bin TEXT UNIQUE,                          -- Building Identification Number
  bbl TEXT UNIQUE,                          -- Borough-Block-Lot
  house_number TEXT NOT NULL,
  street_name TEXT NOT NULL,
  postcode TEXT NOT NULL REFERENCES zip_codes(postcode),
  latitude DECIMAL(10, 8) NOT NULL,         -- From CSV
  longitude DECIMAL(11, 8) NOT NULL,        -- From CSV
  violation_count INT DEFAULT 0,            -- Pre-computed
  rent_impairing_count INT DEFAULT 0,       -- Pre-computed
  avg_days_open INT DEFAULT 0,              -- Pre-computed
  rating DECIMAL(3, 1),                     -- 0.0 to 5.0 stars (pre-computed)
  last_violation_date DATE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW() ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY(postcode) REFERENCES zip_codes(postcode),
  INDEX idx_postcode (postcode),
  INDEX idx_rating (rating),
  INDEX idx_coordinates (latitude, longitude)
);

-- Individual violations (from HPD dataset)
CREATE TABLE violations (
  violation_id TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(building_id),
  postcode TEXT NOT NULL REFERENCES zip_codes(postcode),
  inspection_date DATE NOT NULL,
  current_status TEXT NOT NULL,             -- NOT COMPLIED WITH, SECOND NO ACCESS, etc
  violation_status TEXT NOT NULL,           -- Open, Closed
  rent_impairing BOOLEAN DEFAULT FALSE,     -- Y/N from CSV
  nov_description TEXT,                     -- What's the violation about (heat, plumbing, etc)
  nov_type TEXT,                            -- Category of violation
  days_open INT GENERATED ALWAYS AS (
    CAST((NOW() - inspection_date) / INTERVAL '1 day' AS INT)
  ) STORED,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW() ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_building (building_id),
  INDEX idx_postcode (postcode),
  INDEX idx_status (current_status),
  INDEX idx_date (inspection_date),
  INDEX idx_rent_impairing (rent_impairing)
);

-- Pre-computed zip code summary (updated nightly)
CREATE TABLE zip_summaries (
  postcode TEXT PRIMARY KEY REFERENCES zip_codes(postcode),
  total_violations INT DEFAULT 0,
  total_buildings INT DEFAULT 0,
  average_rating DECIMAL(3, 1),
  worst_building_id TEXT REFERENCES buildings(building_id),
  last_updated TIMESTAMP DEFAULT NOW(),
  INDEX idx_updated (last_updated)
);

-- ============================================================================
-- AUTH TABLES (Phase 2 - User features)
-- ============================================================================

-- Users synced from Firebase
-- IMPORTANT: user_id is the Firebase UID (alphanumeric string ~28 chars)
-- Example Firebase UID: "AXxIpzNz3wfVcH5KL2mJ0pQ1rS2tU3v4"
--
-- Sync flow:
-- 1. User creates account in Firebase → Firebase generates uid
-- 2. Frontend calls POST /api/auth/sync with Firebase token
-- 3. Backend extracts uid from token via verifyIdToken()
-- 4. Backend inserts/updates row: INSERT INTO users (user_id, email) VALUES (uid, email)
-- 5. All subsequent queries use user_id = uid
CREATE TABLE users (
  user_id TEXT PRIMARY KEY,                 -- Firebase UID
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW() ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_email (email)
);

-- Saved buildings (Phase 2)
-- User (via Firebase uid) saves buildings to review later
CREATE TABLE saved_buildings (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  building_id TEXT NOT NULL REFERENCES buildings(building_id),
  saved_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, building_id),
  INDEX idx_user (user_id),
  INDEX idx_building (building_id)
);

-- Audit logs (track all user actions)
-- Used for analytics: who viewed what, when, how often
CREATE TABLE audit_logs (
  id SERIAL PRIMARY KEY,
  user_id TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  action TEXT NOT NULL,                     -- "view_building", "save_building", "search_zip"
  resource_id TEXT,                        -- building_id or postcode
  resource_type TEXT,                      -- "building", "zip"
  timestamp TIMESTAMP DEFAULT NOW(),
  ip_address TEXT,
  user_agent TEXT,
  INDEX idx_user (user_id),
  INDEX idx_timestamp (timestamp),
  INDEX idx_action (action)
);

-- ============================================================================
-- INDEXES & CONSTRAINTS
-- ============================================================================

-- Ensure buildings in a zip exist in zip_codes
ALTER TABLE buildings ADD CONSTRAINT fk_zip
  FOREIGN KEY (postcode) REFERENCES zip_codes(postcode);

-- Ensure violations can't be orphaned when building deleted
ALTER TABLE violations ADD CONSTRAINT fk_building
  FOREIGN KEY (building_id) REFERENCES buildings(building_id) ON DELETE CASCADE;

-- ============================================================================
-- VIEWS (optional - for common queries)
-- ============================================================================

-- Building details with all associated data
CREATE VIEW building_details AS
  SELECT 
    b.*,
    COUNT(v.violation_id) as total_violations,
    SUM(CASE WHEN v.rent_impairing THEN 1 ELSE 0 END) as rent_impairing_violations,
    AVG(EXTRACT(DAY FROM (NOW() - v.inspection_date))) as avg_days_open
  FROM buildings b
  LEFT JOIN violations v ON b.building_id = v.building_id
  GROUP BY b.building_id;

-- User dashboard summary
CREATE VIEW user_summary AS
  SELECT 
    u.user_id,
    u.email,
    COUNT(sb.id) as saved_buildings,
    COUNT(al.id) as total_actions,
    MAX(al.timestamp) as last_action
  FROM users u
  LEFT JOIN saved_buildings sb ON u.user_id = sb.user_id
  LEFT JOIN audit_logs al ON u.user_id = al.user_id
  GROUP BY u.user_id;

-- ============================================================================
-- SAMPLE QUERIES
-- ============================================================================

-- Get top 10 buildings by rating in a zip
-- SELECT * FROM buildings WHERE postcode = '11106' ORDER BY rating DESC LIMIT 10;

-- Get all violations for a building
-- SELECT * FROM violations WHERE building_id = '12345' ORDER BY inspection_date DESC;

-- Get user's saved buildings (requires Firebase UID)
-- SELECT sb.*, b.* FROM saved_buildings sb
--   JOIN buildings b ON sb.building_id = b.building_id
--   WHERE sb.user_id = 'AXxIpzNz3wfVcH5KL2mJ0pQ1rS2tU3v4';

-- Log a user action (requires Firebase UID)
-- INSERT INTO audit_logs (user_id, action, resource_id, resource_type, ip_address)
--   VALUES ('AXxIpzNz3wfVcH5KL2mJ0pQ1rS2tU3v4', 'view_building', '12345', 'building', '192.168.1.1');

-- Get user's recent actions
-- SELECT * FROM audit_logs WHERE user_id = 'AXxIpzNz3wfVcH5KL2mJ0pQ1rS2tU3v4'
--   ORDER BY timestamp DESC LIMIT 50;

-- ============================================================================
-- NOTES
-- ============================================================================

-- Firebase UID Format:
-- - Alphanumeric, ~28 characters
-- - Example: AXxIpzNz3wfVcH5KL2mJ0pQ1rS2tU3v4
-- - Always use TEXT type (not UUID)
-- - Unique per Firebase project
-- - Never changes for a user
-- - Can be obtained via:
--   - Frontend: auth.currentUser.uid
--   - Backend (from token): adminAuth.verifyIdToken(token).uid

-- Rating Formula (0-5 stars):
-- violation_weight = MIN(violation_count / 50, 1) * 2       (max 2 points)
-- age_weight = MIN(avg_days_open / 2000, 1) * 2             (max 2 points)
-- rent_impairing_weight = MIN(rent_impairing_count / 20, 1) * 1 (max 1 point)
-- rating = 5 - (violation_weight + age_weight + rent_impairing_weight)
-- rating = MAX(0, MIN(5, rating))

-- Performance Tuning:
-- - buildings and violations tables are large (10k+ buildings, 10k+ violations)
-- - Always filter by postcode first
-- - Use LIMIT on results
-- - Pre-compute ratings nightly
-- - Consider partitioning violations by postcode if it grows beyond 100k rows
