import { acceptInvite } from '@/app/console/_actions/org';
import { consoleContext } from '@/lib/console/context';
import { ActionForm, Submit } from '@/components/console/forms';

export const metadata = { title: 'Join an organisation' };

export default async function Invite({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { user } = await consoleContext();
  return (
    <div className="max-w-lg">
      <h1 className="font-display text-[2.4rem] leading-tight">You’ve been invited</h1>
      <p className="mt-3 text-ink-2">Join as {user.email}. The invite only works for the address it was sent to.</p>
      <ActionForm action={acceptInvite} className="mt-8">
        <input type="hidden" name="token" value={token} />
        <Submit pending="Joining">Join organisation</Submit>
      </ActionForm>
    </div>
  );
}
