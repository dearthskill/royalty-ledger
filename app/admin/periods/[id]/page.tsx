import { notFound } from 'next/navigation';
import { PeriodDetail } from './PeriodDetail';

export default async function PeriodPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) notFound();
  return <PeriodDetail id={id} />;
}
