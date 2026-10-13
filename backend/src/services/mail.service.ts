// Placeholder until a mail provider is wired: the link is only logged outside production,
// so a secret token never ends up in production logs
export async function sendSetupLink(email: string, link: string): Promise<void> {
  if (process.env.NODE_ENV === 'production') return;
  console.info(`[mail] Password setup link for ${email}: ${link}`);
}
