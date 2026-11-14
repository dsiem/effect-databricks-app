/** UUID v4 using the Web Crypto API available in both HTTP and HTTPS contexts. */
export function randomUuid(): string {
  const hex = Array.from(
    crypto.getRandomValues(new Uint8Array(16)),
    (byte, index) => {
      const value =
        index === 6
          ? (byte & 0x0f) | 0x40
          : index === 8
            ? (byte & 0x3f) | 0x80
            : byte;
      return value.toString(16).padStart(2, "0");
    },
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
