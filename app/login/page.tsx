import { LoginForm } from './LoginForm';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <div className="flex justify-center pt-12">
      <LoginForm next={next ?? '/'} />
    </div>
  );
}
