export function Placeholder({ name, description, icon }: { name: string; description: string; icon: string }) {
  return (
    <div className="placeholder-page">
      <div style={{ fontSize: 44 }}>{icon}</div>
      <div style={{ fontSize: 20, color: 'var(--text)' }}>{name}</div>
      <div style={{ fontSize: 14, maxWidth: 420, textAlign: 'center', lineHeight: 1.6 }}>{description}</div>
    </div>
  );
}
