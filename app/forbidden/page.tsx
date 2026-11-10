import Link from 'next/link';

export default function Forbidden() {
  return (
    <div className="card max-w-md space-y-2">
      <h1 className="text-lg font-semibold">403 · Not allowed</h1>
      <p className="text-sm text-slate-500">Your role cannot open this page.</p>
      <Link href="/" className="btn-secondary">Back to start</Link>
    </div>
  );
}
