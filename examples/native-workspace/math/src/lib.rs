/// A generic local crate, compiled separately by Cargo.
pub fn sum<T>(values: impl IntoIterator<Item = T>) -> T
where
    T: std::iter::Sum<T>,
{
    values.into_iter().sum()
}

#[cfg(test)]
mod tests {
    #[test]
    fn sums_values() {
        assert_eq!(super::sum([10_i64, 20, 12]), 42);
    }
}
