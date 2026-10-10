// A strict Gregorian dd.mm.yyyy parser; no locale, timezone or Date rollover.
pub fn date(text: String) -> Option<i64> {
    let bytes = text.into_bytes();
    if bytes.len() != 10 || bytes[2] != 46 || bytes[5] != 46 { return None; }
    let mut n: i64 = 0;
    let mut day: i64 = 0;
    let mut month: i64 = 0;
    for i in 0..10 {
        if i == 2 { day = n; n = 0; } else if i == 5 { month = n; n = 0; }
        else { let b = bytes[i]; if b < 48 || b > 57 { return None; } n = n * 10 + (b - 48) as i64; }
    }
    let year = n;
    if year < 1 || month < 1 || month > 12 { return None; }
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days: i64 = if month == 2 { if leap { 29 } else { 28 } } else if month == 4 || month == 6 || month == 9 || month == 11 { 30 } else { 31 };
    if day < 1 || day > days { None } else { Some(year * 10000 + month * 100 + day) }
}
pub fn allowed(start: String, end: String, returning: bool) -> bool {
    if let Some(first) = date(start) { if !returning { return true; } if let Some(last) = date(end) { return last >= first; } }
    false
}
