/**
 * A3-C8: Bengali-script storefront search.
 *
 * The catalog (product names, category names/slugs) is stored in Latin
 * script, so a shopper typing Bangla — e.g. "পাঞ্জাবি" — matched
 * nothing while the transliteration "panjabi" returned 40 products.
 * There is no Bangla name column in the DB schema, so common Bangla
 * product/category words are aliased here to their Latin catalog
 * terms and the search runs against both. Word-level: each Bangla
 * word in the query is translated independently; unknown words are
 * dropped from the translated variant (the original term is always
 * searched too, so any genuinely-Bangla catalog text still matches).
 */
const BN_SEARCH_ALIASES: Record<string, string> = {
  "পাঞ্জাবি": "panjabi",
  "পাঞ্জাবী": "panjabi",
  "কুর্তা": "kurta",
  "ফতুয়া": "fatua",
  "কাবলি": "kabli",
  "শার্ট": "shirt",
  "টি-শার্ট": "t-shirt",
  "টিশার্ট": "t-shirt",
  "গেঞ্জি": "t-shirt",
  "পোলো": "polo",
  "হেনলি": "henley",
  "প্যান্ট": "pants",
  "ট্রাউজার": "trousers",
  "চিনো": "chinos",
  "জিন্স": "jeans",
  "ডেনিম": "denim",
  "পায়জামা": "pajama",
  "লুঙ্গি": "lungi",
  "ধুতি": "dhoti",
  "জ্যাকেট": "jacket",
  "ব্লেজার": "blazer",
  "স্যুট": "suit",
  "কোট": "coat",
  "ওয়েস্টকোট": "waistcoat",
  "সোয়েটার": "sweater",
  "হুডি": "hoodie",
  "বেল্ট": "belt",
  "জুতা": "shoes",
  "স্যান্ডেল": "sandal",
  "সানগ্লাস": "sunglasses",
  "ঘড়ি": "watch",
  "টুপি": "cap",
  "মোজা": "socks",
  "শাড়ি": "saree",
  "থ্রি-পিস": "three piece",
  "ওড়না": "orna",
  "হিজাব": "hijab",
  "বোরকা": "burqa",
  "আন্ডারওয়্যার": "underwear",
};

const BENGALI_SCRIPT = /[\u0980-\u09FF]/;

/**
 * Return the search terms to run for a raw shopper query: the query
 * itself, plus its Latin transliteration when it contains Bengali
 * script and at least one known alias word.
 */
export function expandSearchTerms(raw: string): string[] {
  const term = (raw || "").trim();
  if (!term) return [];
  if (!BENGALI_SCRIPT.test(term)) return [term];
  const translated = term
    .split(/\s+/)
    .map((word) => BN_SEARCH_ALIASES[word] || "")
    .filter(Boolean)
    .join(" ");
  return translated ? [term, translated] : [term];
}
