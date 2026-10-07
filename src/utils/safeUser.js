export function toSafeUser(user) {
  if (!user) return null;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    domainId: user.domainId ?? null
  };
}
