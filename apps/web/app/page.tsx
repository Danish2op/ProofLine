import Link from 'next/link';

export default function HomePage() {
  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: '12vh 24px' }}>
      <p style={{ color: '#8ce6c1', letterSpacing: 2 }}>
        PROOFLINE / DEVELOPER PREVIEW
      </p>
      <h1 style={{ fontSize: 64, lineHeight: 1.05, maxWidth: 720 }}>
        Approved action differs from requested action? Block it.
      </h1>
      <p style={{ fontSize: 21, color: '#b9c1d0', maxWidth: 680 }}>
        Proofline binds agent proposals, human approval in Buzz, and execution
        to the same immutable action passport.
      </p>
      <Link
        href="/demo"
        style={{
          display: 'inline-block',
          marginTop: 28,
          padding: '14px 20px',
          borderRadius: 10,
          background: '#8ce6c1',
          color: '#10131a',
          textDecoration: 'none',
          fontWeight: 700,
        }}
      >
        Run offline technical replay →
      </Link>
    </main>
  );
}
