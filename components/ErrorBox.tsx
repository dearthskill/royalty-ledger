// Shows an error message exactly as the API (and so the database) phrased it.
export function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="error" role="alert">{error}</div>;
}
