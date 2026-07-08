/** Resolve a public/ asset path against the Vite base so subpath deploys work. */
export function assetUrl(path: string): string {
  return import.meta.env.BASE_URL + path.replace(/^\//, '');
}
