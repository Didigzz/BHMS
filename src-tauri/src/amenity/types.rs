//! IPC payloads for amenity billing. Field visibility is crate-wide because the
//! write modules validate and persist these structs field by field.

#[derive(serde::Deserialize)]
pub(crate) struct AmenityTenantInput {
    pub(crate) tenant_id: i64,
    pub(crate) amount: f64,
    /// Pinned by the landlord instead of taking the automatic remainder
    /// (amenity-manual-split-spec.md §3.2). Older payloads default to false.
    #[serde(default)]
    pub(crate) is_manual: bool,
}

#[derive(serde::Deserialize)]
pub(crate) struct AmenityExcludedInput {
    pub(crate) tenant_id: i64,
    pub(crate) reason: String,
}

#[derive(serde::Deserialize)]
pub(crate) struct AmenityBillInput {
    pub(crate) bill_id: Option<i64>,
    pub(crate) amenity_name: String,
    pub(crate) billing_method: String,
    pub(crate) total_amount: f64,
    pub(crate) billing_date: String,
    pub(crate) billing_period: Option<String>,
    pub(crate) notes: Option<String>,
    pub(crate) division_mode: String,
    pub(crate) meter_start: Option<f64>,
    pub(crate) meter_end: Option<f64>,
    pub(crate) price_per_unit: Option<f64>,
    pub(crate) tenants: Vec<AmenityTenantInput>,
    pub(crate) excluded: Vec<AmenityExcludedInput>,
    pub(crate) room_ids: Vec<i64>,
}
