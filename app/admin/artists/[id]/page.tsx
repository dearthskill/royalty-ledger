import { notFound } from 'next/navigation';
import { ArtistProfile } from './ArtistProfile';

export default async function ArtistPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) notFound();
  return <ArtistProfile id={id} />;
}
