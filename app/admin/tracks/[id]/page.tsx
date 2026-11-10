import { notFound } from 'next/navigation';
import { TrackDetail } from './TrackDetail';

export default async function TrackPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) notFound();
  return <TrackDetail id={id} />;
}
