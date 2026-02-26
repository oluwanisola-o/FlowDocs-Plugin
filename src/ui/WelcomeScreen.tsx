import { useState, useEffect, useRef } from 'react';

const FEATURES = [
  {
    icon: '\u2728',
    title: 'Smart Screen Documentation',
    desc: 'Generate detailed handoff docs for each screen including purpose, use cases, edge cases, animations, and component references.',
  },
  {
    icon: '\uD83C\uDFA8',
    title: 'Missing Screen Generation',
    desc: 'Creates missing screens based on your design system. Uses AI vision to match your existing screens.',
  },
  {
    icon: '\uD83D\uDD04',
    title: 'Flow Analysis',
    desc: 'Analyze complete user journeys across multiple screens. Automatically identifies entry points, decision trees, and gaps.',
  },
  {
    icon: '\uD83E\uDD16',
    title: 'Multi-AI Support',
    desc: 'Choose Anthropic Claude, OpenAI GPT, or Google Gemini. Switch models anytime.',
  },
  {
    icon: '\u26A0\uFE0F',
    title: 'Edge Case Detection',
    desc: 'AI scans your flows and detects missing screens like loading states, error states, and empty states. Prioritizes by severity.',
  },
  {
    icon: '\uD83D\uDCCB',
    title: 'Card-Based Documentation',
    desc: 'Each doc section appears in its own card for easy reading and sharing with developers.',
  },
];

const STEPS = [
  { num: '1', title: 'Connect your AI API key', desc: 'Choose Anthropic Claude, OpenAI GPT, or Google Gemini and paste your API key.' },
  { num: '2', title: 'Select your screens', desc: 'Choose the frames in Figma you want to document or analyze.' },
  { num: '3', title: 'Generate documentation', desc: 'Click "Create Handoff Doc" to generate dev-ready documentation cards.' },
  { num: '4', title: 'Analyze flows (optional)', desc: 'Click "Scan Flow" to analyze user journeys and detect missing edge cases.' },
  { num: '5', title: 'Create missing screens (optional)', desc: 'Generate any missing screens identified \u2014 AI matches your design system.' },
  { num: '6', title: 'Share with developers', desc: 'Documentation appears on your canvas, ready to share or export.' },
];

export default function WelcomeScreen({ onGetStarted }: { onGetStarted: () => void }) {
  const [visible, setVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const handleDismiss = () => {
    setVisible(false);
    setTimeout(onGetStarted, 400);
  };

  return (
    <div ref={containerRef} style={{
      ...styles.root,
      opacity: visible ? 1 : 0,
      transition: 'opacity 0.4s ease',
    }}>
      {/* Close button */}
      <button type="button" onClick={handleDismiss} style={styles.closeBtn} aria-label="Close">&times;</button>

      {/* ── Hero Section ── */}
      <section style={styles.hero}>
        <div style={styles.heroLeft}>
          <h1 style={styles.heroTitle}>FlowDoc</h1>
          <p style={styles.heroTagline}>AI-Powered Design Handoff Documentation</p>
          <div style={styles.pillRow}>
            {['Auto Documentation', 'Flow Analysis', 'Screen Generation'].map((t) => (
              <span key={t} style={styles.pill}>{t}</span>
            ))}
          </div>
        </div>
        <div style={styles.heroRight}>
          <div style={styles.previewCard}>
            <div style={styles.previewHeader}>
              <span style={styles.previewHeaderTitle}>FlowDoc</span>
              <span style={styles.previewHeaderX}>&times;</span>
            </div>
            <div style={styles.previewField}>
              <span style={styles.previewFieldLabel}>Provider</span>
              <div style={styles.previewInput}>Anthropic (Claude)</div>
            </div>
            <div style={styles.previewField}>
              <span style={styles.previewFieldLabel}>API Key</span>
              <div style={styles.previewInput}>
                <span style={{ letterSpacing: 2, color: '#888' }}>{'\u2022'.repeat(20)}</span>
              </div>
            </div>
            <div style={styles.previewField}>
              <span style={styles.previewFieldLabel}>Model</span>
              <div style={styles.previewInput}>Claude Sonnet 4</div>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <span style={styles.previewBadge}>5 frames selected</span>
            </div>
            <div style={styles.previewBtnPrimary}>Create Handoff Doc</div>
            <div style={styles.previewBtnSecondary}>Scan Flow</div>
          </div>
        </div>
      </section>

      {/* ── Divider ── */}
      <div style={styles.divider} />

      {/* ── Features Section ── */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Features</h2>
        <div style={styles.featuresGrid}>
          {FEATURES.map((f) => (
            <div key={f.title} style={styles.featureCard}>
              <span style={styles.featureIcon}>{f.icon}</span>
              <h3 style={styles.featureTitle}>{f.title}</h3>
              <p style={styles.featureDesc}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Divider ── */}
      <div style={styles.divider} />

      {/* ── How to Use Section ── */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>How to Use</h2>
        <div style={styles.stepsGrid}>
          {STEPS.map((s) => (
            <div key={s.num} style={styles.stepCard}>
              <div style={styles.stepNum}>{s.num}</div>
              <h3 style={styles.stepTitle}>{s.title}</h3>
              <p style={styles.stepDesc}>{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Bottom Notes ── */}
      <div style={styles.divider} />
      <section style={styles.notesSection}>
        <p style={styles.noteText}>
          <span style={styles.noteIcon}>{'\uD83D\uDCA1'}</span>
          Requires API key from Anthropic ($5 free credit), OpenAI ($5 free credit), or Google (free tier). Your key is stored locally.
        </p>
        <p style={styles.noteText}>
          <span style={styles.noteIcon}>{'\uD83D\uDE80'}</span>
          Currently in beta — feedback welcome!
        </p>
      </section>

      {/* ── CTA Button ── */}
      <button type="button" onClick={handleDismiss} style={styles.ctaButton}>
        Get Started
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Styles (inline for self-contained component)
   ═══════════════════════════════════════════════════════════════════════ */

const styles: Record<string, React.CSSProperties> = {
  root: {
    position: 'fixed',
    inset: 0,
    zIndex: 10000,
    background: 'linear-gradient(180deg, #0a0a1a 0%, #1a1a2e 100%)',
    overflowY: 'auto',
    overflowX: 'hidden',
    padding: '40px 32px 48px',
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: '#ffffff',
    WebkitFontSmoothing: 'antialiased',
  },

  closeBtn: {
    position: 'fixed',
    top: 12,
    right: 12,
    zIndex: 10001,
    background: 'rgba(255,255,255,0.08)',
    border: 'none',
    borderRadius: '50%',
    width: 32,
    height: 32,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 20,
    color: '#a0a0a0',
    cursor: 'pointer',
    lineHeight: 1,
  },

  /* ─── Hero ─── */
  hero: {
    display: 'flex',
    gap: 32,
    alignItems: 'center',
    marginBottom: 40,
    flexWrap: 'wrap' as const,
  },
  heroLeft: {
    flex: '1 1 240px',
    minWidth: 0,
  },
  heroTitle: {
    margin: '0 0 8px',
    fontSize: 56,
    fontWeight: 700,
    letterSpacing: '-0.03em',
    lineHeight: 1.1,
    color: '#ffffff',
  },
  heroTagline: {
    margin: '0 0 20px',
    fontSize: 18,
    fontWeight: 400,
    color: '#a0a0a0',
    lineHeight: 1.4,
  },
  pillRow: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 10,
  },
  pill: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '8px 18px',
    borderRadius: 24,
    background: 'rgba(255,255,255,0.08)',
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 500,
    whiteSpace: 'nowrap' as const,
    border: '1px solid rgba(255,255,255,0.06)',
  },

  /* ─── Hero right: preview ─── */
  heroRight: {
    flex: '0 0 auto',
    display: 'flex',
    justifyContent: 'center',
  },
  previewCard: {
    width: 220,
    background: '#1e1e1e',
    borderRadius: 12,
    padding: 16,
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    border: '1px solid #2a2a2a',
    transform: 'rotate(2deg)',
  },
  previewHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  previewHeaderTitle: {
    fontWeight: 600,
    fontSize: 14,
    color: '#fff',
  },
  previewHeaderX: {
    color: '#666',
    fontSize: 16,
    cursor: 'default',
  },
  previewField: {
    marginBottom: 10,
  },
  previewFieldLabel: {
    display: 'block',
    fontSize: 10,
    fontWeight: 500,
    color: '#888',
    marginBottom: 4,
  },
  previewInput: {
    background: '#2a2a2a',
    border: '1px solid #3a3a3a',
    borderRadius: 6,
    padding: '6px 8px',
    fontSize: 11,
    color: '#ccc',
  },
  previewBadge: {
    display: 'inline-block',
    background: '#1e2d40',
    color: '#5c9eff',
    fontSize: 10,
    fontWeight: 500,
    padding: '4px 10px',
    borderRadius: 12,
  },
  previewBtnPrimary: {
    background: '#0066cc',
    color: '#fff',
    fontSize: 11,
    fontWeight: 500,
    textAlign: 'center' as const,
    padding: '7px 0',
    borderRadius: 6,
    marginTop: 10,
  },
  previewBtnSecondary: {
    background: '#2a2a2a',
    color: '#fff',
    fontSize: 11,
    fontWeight: 500,
    textAlign: 'center' as const,
    padding: '7px 0',
    borderRadius: 6,
    marginTop: 6,
    border: '1px solid #3a3a3a',
  },

  /* ─── Divider ─── */
  divider: {
    height: 1,
    background: 'rgba(255,255,255,0.06)',
    margin: '32px 0',
  },

  /* ─── Sections ─── */
  section: {
    marginBottom: 8,
  },
  sectionTitle: {
    margin: '0 0 20px',
    fontSize: 22,
    fontWeight: 700,
    color: '#ffffff',
    letterSpacing: '-0.01em',
  },

  /* ─── Features grid ─── */
  featuresGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: 14,
  },
  featureCard: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 12,
    padding: 16,
  },
  featureIcon: {
    display: 'block',
    fontSize: 22,
    marginBottom: 8,
  },
  featureTitle: {
    margin: '0 0 6px',
    fontSize: 14,
    fontWeight: 600,
    color: '#ffffff',
  },
  featureDesc: {
    margin: 0,
    fontSize: 12,
    color: '#999',
    lineHeight: 1.5,
  },

  /* ─── Steps grid ─── */
  stepsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 12,
  },
  stepCard: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 12,
    padding: 14,
  },
  stepNum: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    borderRadius: '50%',
    background: '#0066cc',
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 700,
    marginBottom: 10,
  },
  stepTitle: {
    margin: '0 0 6px',
    fontSize: 13,
    fontWeight: 600,
    color: '#ffffff',
  },
  stepDesc: {
    margin: 0,
    fontSize: 11,
    color: '#999',
    lineHeight: 1.5,
  },

  /* ─── Notes ─── */
  notesSection: {
    marginBottom: 28,
  },
  noteText: {
    margin: '0 0 8px',
    fontSize: 12,
    color: '#888',
    lineHeight: 1.5,
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
  },
  noteIcon: {
    flexShrink: 0,
    fontSize: 14,
  },

  /* ─── CTA ─── */
  ctaButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    padding: '16px 48px',
    background: '#0066cc',
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 500,
    fontFamily: 'inherit',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    transition: 'background 0.15s ease',
  },
};
