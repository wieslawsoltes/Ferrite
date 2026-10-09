/** JSON-safe scalar MIR literals; Runtime.literal decodes using the declared type.
 * Strings avoid JSON's loss of NaN, infinities and the sign bit of negative zero.
 * NaN payload bits are intentionally unspecified; numeric values are preserved.
 */
export class LiteralValue {
  static encode(value) {
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'number') {
      if (Object.is(value, -0)) return '-0';
      if (!Number.isFinite(value)) return String(value);
    }
    return value;
  }
}
