-- Amenity types are gone: a bill is a free-text amenity name plus optional
-- notes, and the 9 well-known names live in the frontend as quick-pick
-- presets (src/lib/amenity-billing.ts AMENITY_PRESETS). The column-level
-- CHECK constraint on amenity_type is dropped with the column, so landlords
-- can name any amenity ("Cable TV", "Generator share", …) without a schema
-- change. Existing type values are intentionally discarded
-- (amenity-billing-spec.md §5, decisions #20-#22).
ALTER TABLE amenity_bills DROP COLUMN amenity_type;
