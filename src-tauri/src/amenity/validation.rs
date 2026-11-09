//! Structural re-check of the payload that arrived over IPC.

use super::types::AmenityBillInput;

/// Shares may run up to ₱1 below the bill total (the landlord absorbs the
/// leftover centavos, spec §8.1) but never above it. Mirrors MAX_ABSORBED in
/// src/lib/amenity-billing.ts.
pub(crate) const AMENITY_MAX_ABSORBED: f64 = 1.0;

pub(crate) fn round2(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

/// Returns a code the frontend translates into a locked message.
pub(crate) fn validate_amenity_input(input: &AmenityBillInput) -> Result<(), String> {
    if input.amenity_name.trim().is_empty() {
        return Err("amenity:name".to_string());
    }
    if !input.total_amount.is_finite() || input.total_amount <= 0.0 {
        return Err("amenity:amount".to_string());
    }
    if !matches!(input.billing_method.as_str(), "shared" | "per_room" | "connected") {
        return Err("amenity:method".to_string());
    }
    if input.division_mode != "auto" && input.division_mode != "manual" {
        return Err("amenity:division-mode".to_string());
    }
    if input.billing_method != "shared" && input.room_ids.is_empty() {
        return Err("amenity:selection".to_string());
    }
    if input.billing_method == "shared" && input.tenants.is_empty() && input.excluded.is_empty() {
        return Err("amenity:selection".to_string());
    }
    if input.billing_method == "connected" && input.room_ids.len() < 2 {
        return Err("amenity:connected-rooms".to_string());
    }
    if input.excluded.iter().any(|row| row.reason.trim().is_empty()) {
        return Err("amenity:exclusion-reason".to_string());
    }
    if input.tenants.iter().any(|row| !row.amount.is_finite() || row.amount < 0.0) {
        return Err("amenity:negative-amount".to_string());
    }
    let excluded_ids: std::collections::HashSet<i64> =
        input.excluded.iter().map(|row| row.tenant_id).collect();
    let billed: Vec<&super::types::AmenityTenantInput> = input
        .tenants
        .iter()
        .filter(|row| !excluded_ids.contains(&row.tenant_id))
        .collect();
    let manual_sum = round2(
        billed
            .iter()
            .filter(|row| row.is_manual)
            .map(|row| row.amount)
            .sum::<f64>(),
    );
    if manual_sum > round2(input.total_amount) + 0.005 {
        return Err("amenity:manual-exceeds".to_string());
    }
    let all_manual = !billed.is_empty() && billed.iter().all(|row| row.is_manual);
    if all_manual {
        let shortfall = round2(input.total_amount - manual_sum);
        if shortfall < -0.005 || shortfall > AMENITY_MAX_ABSORBED + 0.005 {
            return Err("amenity:manual-sum".to_string());
        }
    }
    if input.division_mode == "manual" {
        let sum: f64 = input.tenants.iter().map(|row| row.amount).sum();
        let shortfall = round2(input.total_amount - round2(sum));
        if shortfall < -0.005 || shortfall > AMENITY_MAX_ABSORBED + 0.005 {
            return Err("amenity:manual-sum".to_string());
        }
    }
    Ok(())
}
