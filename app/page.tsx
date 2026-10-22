import { getShowcase } from '@/lib/server/personas';
import { HomeView } from '@/components/landing/HomeView';

export default async function Home() {
  const showcase = await getShowcase(4);
  return <HomeView showcase={showcase} />;
}
