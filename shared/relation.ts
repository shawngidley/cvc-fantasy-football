/** Supabase returns an embedded relation as a single object for a many to one link and as an
 * array for a one to many link. Code that assumed one shape silently got undefined from the
 * other. This accepts both. */
export function one<T>(value: T | T[] | null | undefined): T | undefined {
  return (Array.isArray(value) ? value[0] : value) ?? undefined;
}
