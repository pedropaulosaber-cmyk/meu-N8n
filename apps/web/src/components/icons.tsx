/**
 * Ícones referenciados pelos módulos do registry através do campo `icon`.
 *
 * Um módulo novo que use um nome ainda não mapeado aqui cai no fallback
 * em vez de quebrar a tela — o painel nunca deve depender de conhecer
 * antecipadamente cada integração.
 */

const paths: Record<string, React.ReactNode> = {
  zap: <path d="M9 1.5 3 9h4l-1 5.5L13 7H8.5z" />,
  webhook: <path d="M4 6a4 4 0 1 1 6.5 3.1M11.5 11a4 4 0 1 1-1.2-6.6M6 12.5a4 4 0 0 0 6-1" />,
  clock: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l2.5 1.5" />
    </>
  ),
  sparkles: <path d="M8 2l1.4 3.6L13 7l-3.6 1.4L8 12l-1.4-3.6L3 7l3.6-1.4z" />,
  globe: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12M8 2c1.6 1.9 2.4 3.9 2.4 6S9.6 12.1 8 14c-1.6-1.9-2.4-3.9-2.4-6S6.4 3.9 8 2z" />
    </>
  ),
  key: (
    <>
      <circle cx="5.5" cy="8" r="3" />
      <path d="M8.5 8H14M12 8v2.5" />
    </>
  ),
  list: <path d="M2.5 4h11M2.5 8h11M2.5 12h7" />,
  settings: (
    <>
      <circle cx="8" cy="8" r="2.4" />
      <path d="M8 1.6v1.8M8 12.6v1.8M14.4 8h-1.8M3.4 8H1.6M12.5 3.5l-1.3 1.3M4.8 11.2l-1.3 1.3M12.5 12.5l-1.3-1.3M4.8 4.8 3.5 3.5" />
    </>
  ),
  plug: <path d="M6 2v4M10 2v4M4.5 6h7v2.5a3.5 3.5 0 0 1-7 0zM8 12v2.5" />,
};

export function IntegrationIcon({
  name,
  size = 16,
}: {
  name: string;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {paths[name] ?? paths.plug}
    </svg>
  );
}

export function Icon({
  name,
  size = 16,
}: {
  name: keyof typeof paths;
  size?: number;
}) {
  return <IntegrationIcon name={name} size={size} />;
}
