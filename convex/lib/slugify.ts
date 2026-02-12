/**
 * Turn a human title into a URL-safe slug.
 * 
 * Strips everything except lowercase alphanumerics and hyphens,
 * collapses runs of hyphens, trims leading/trailing hyphens,
 * and caps length at 100 characters.
 * 
 * @param text - The text to slugify
 * @returns A URL-safe slug string
 * 
 * @example
 *   slugify("Hello World!") // "hello-world"
 *   slugify("  Test---Post  ") // "test-post"
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}
