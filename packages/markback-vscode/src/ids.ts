const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function generateRecordId(): string {
  const part = () => {
    let s = "";
    for (let i = 0; i < 4; i++) {
      s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
    return s;
  };
  return `${part()}-${part()}`;
}
