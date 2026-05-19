/**
 * Shared app footer — matches landing page footer.
 * Used on login, register, dashboard, and wizard pages.
 */
export function AppFooter({ style }: { style?: React.CSSProperties }) {
  const links = ['Privacy', 'Terms', 'Support', 'Status']
  return (
    <footer style={{
      background: '#fff',
      borderTop: '1px solid #E5E7EB',
      padding: '16px 32px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexShrink: 0,
      fontFamily: "'Inter', -apple-system, sans-serif",
      ...style,
    }}>
      <span style={{ fontSize: 12, color: '#9CA3AF' }}>
        © {new Date().getFullYear()} schedU. All rights reserved.
      </span>
      <div style={{ display: 'flex', gap: 20 }}>
        {links.map(l => (
          <a key={l} href="#" style={{
            fontSize: 12, color: '#9CA3AF', textDecoration: 'none',
            transition: 'color 0.13s',
          }}
            onMouseEnter={e => (e.currentTarget.style.color = '#6B7280')}
            onMouseLeave={e => (e.currentTarget.style.color = '#9CA3AF')}
          >
            {l}
          </a>
        ))}
      </div>
    </footer>
  )
}
