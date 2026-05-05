-- Migration: add_performance_indexes
-- Purpose: Reduce full-table scans on the profiles table for the three
--          fields that appear in every query filter.
--
-- Why these indexes?
-- Without indexes, every GET /api/profiles or /api/profiles/search triggers
-- a sequential scan of the entire profiles table. At tens of millions of
-- rows, seq scans are the single largest contributor to query latency.
--
-- Index type: B-tree (default) — optimal for equality checks (gender,
-- country_id) and range queries (age BETWEEN x AND y).
--
-- CONCURRENTLY: builds the index without locking the table for writes.
-- This is critical on a live system — do not remove CONCURRENTLY.
--
-- The composite index on (country_id, gender, age) covers the most common
-- combined query pattern without requiring the planner to intersect two
-- separate indexes.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_profiles_gender
  ON profiles (gender);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_profiles_country_id
  ON profiles (country_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_profiles_age
  ON profiles (age);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_profiles_age_group
  ON profiles (age_group);

-- Composite index for the most common combined filter: country + gender + age
-- The planner will use this for queries like:
--   WHERE country_id = 'NG' AND gender = 'male' AND age BETWEEN 18 AND 35
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_profiles_country_gender_age
  ON profiles (country_id, gender, age);

-- Index on created_at for sort_by=created_at queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_profiles_created_at
  ON profiles (created_at DESC);
