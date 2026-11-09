//! Paid-date validation. The rule is mirrored in
//! src/lib/amenities/amenity-payments.ts.

fn is_leap_year(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

fn days_in_month(year: i32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap_year(year) => 29,
        2 => 28,
        _ => 0,
    }
}

fn parse_iso_date(value: &str) -> Option<(i32, u32, u32)> {
    let bytes = value.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return None;
    }
    let digits = |range: std::ops::Range<usize>| {
        bytes[range].iter().all(|byte| byte.is_ascii_digit())
    };
    if !digits(0..4) || !digits(5..7) || !digits(8..10) {
        return None;
    }
    let year: i32 = value[0..4].parse().ok()?;
    let month: u32 = value[5..7].parse().ok()?;
    let day: u32 = value[8..10].parse().ok()?;
    if month < 1 || month > 12 || day < 1 || day > days_in_month(year, month) {
        return None;
    }
    Some((year, month, day))
}

/// `YYYY-MM-DD`, a real calendar date, and not after the caller's local
/// `today`. Both dates are compared as strings, which is exact for this shape.
///
/// There is no date crate in this crate on purpose (the phone's local date is
/// what the landlord means), so the rule is mirrored in
/// src/lib/amenities/amenity-payments.ts.
pub(crate) fn validate_amenity_paid_date(value: &str, today: &str) -> Result<(), String> {
    if parse_iso_date(value).is_none() || parse_iso_date(today).is_none() {
        return Err("amenity:paid-date".to_string());
    }
    if value > today {
        return Err("amenity:paid-date-future".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_amenity_paid_date;

    #[test]
    fn accepts_today_and_past_dates() {
        assert!(validate_amenity_paid_date("2026-11-09", "2026-11-09").is_ok());
        assert!(validate_amenity_paid_date("2026-11-08", "2026-11-09").is_ok());
        assert!(validate_amenity_paid_date("2024-02-29", "2026-11-09").is_ok());
    }

    #[test]
    fn rejects_a_future_date_with_its_own_code() {
        assert_eq!(
            validate_amenity_paid_date("2026-11-10", "2026-11-09").unwrap_err(),
            "amenity:paid-date-future"
        );
    }

    #[test]
    fn rejects_impossible_and_malformed_dates() {
        for value in [
            "2026-02-30",
            "2026-13-01",
            "2025-02-29",
            "",
            "2026-1-01",
            "2026/11/09",
            "2026-11-9",
        ] {
            assert_eq!(
                validate_amenity_paid_date(value, "2026-11-09").unwrap_err(),
                "amenity:paid-date",
                "{value} must be rejected"
            );
        }
    }
}
