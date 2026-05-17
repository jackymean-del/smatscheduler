import { Component, type ReactNode } from "react"
import { useTimetableStore } from "@/store/timetableStore"
import { useAuthStore } from "@/store/authStore"
import { StepStructure }           from "@/routes/wizard/step-structure"
import { StepResources }           from "@/routes/wizard/step-resources"
import { StepSectionStrengths }    from "@/routes/wizard/step-section-strengths"
import { StepConstraints }         from "@/routes/wizard/step-constraints"
import { Step6Generate }           from "@/routes/wizard/step6-generate"
import { CheckCircle2 } from "lucide-react"

// ── 5-step user-facing wizard ──
// Structure (School+Bell merged) → Resources → Allocations → Constraints → Generate
const STEPS = [StepStructure, StepResources, StepSectionStrengths, StepConstraints, Step6Generate]

// User-facing 5-step model. Internal step implementations unchanged —
// we just relabel + reorder presentation while the engine consumes the
// original data flow described in the schedU implementation doc.
//
//   Structure   = School/board/grades  (Step1Org)
//   Resources   = Days/periods + Teachers/Subjects/Rooms (StepBell, StepResources)
//   Allocations = Section-Subject strength matrix (StepSectionStrengths)
//   Constraints = Scope rules per entity (review existing scope from Resources)
//   Generate    = AI builds the timetable (Step6Generate)
const STEP_META = [
  { label:"Structure",   sub:"School, board, grades & scale",   icon:"🏫", color:"#7C6FE0" },
  { label:"Resources",   sub:"Days, periods, teachers, rooms",  icon:"📋", color:"#9B8EF5" },
  { label:"Allocations", sub:"Students per subject (Excel-feel)", icon:"📊", color:"#7C6FE0" },
  { label:"Constraints", sub:"Scope rules & availability",      icon:"🔒", color:"#9B8EF5" },
  { label:"Generate",    sub:"AI builds your timetable",        icon:"✨", color:"#D4920E" },
]

// ── Error boundary ────────────────────────────────────────────
class StepErrorBoundary extends Component<
  { children: ReactNode; step: number },
  { error: string | null }
> {
  constructor(props: any) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(e: Error) { return { error: e.message } }
  render() {
    if (this.state.error) return (
      <div style={{ padding:28, background:"#fef2f2", border:"1px solid #fecaca", borderRadius:12, margin:24 }}>
        <div style={{ fontSize:14, fontWeight:700, color:"#dc2626", marginBottom:8 }}>⚠️ Step {this.props.step} error</div>
        <div style={{ fontSize:11, color:"#7f1d1d", fontFamily:"monospace", marginBottom:16, whiteSpace:"pre-wrap", maxHeight:120, overflow:'auto' }}>{this.state.error}</div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={() => { this.setState({ error:null }); useTimetableStore.getState().resetWizard() }}
            style={{ padding:"7px 14px", borderRadius:7, border:"none", background:"#dc2626", color:"#fff", cursor:"pointer", fontSize:12 }}>
            Reset Wizard
          </button>
          <button onClick={() => this.setState({ error:null })}
            style={{ padding:"7px 14px", borderRadius:7, border:"1px solid #fecaca", background:"#fff", color:"#dc2626", cursor:"pointer", fontSize:12 }}>
            Try Again
          </button>
        </div>
      </div>
    )
    return this.props.children
  }
}

// ── Sidebar palette — Bhusku / SchedU White Lavender ──────────
const SB_BG     = '#FFFFFF'   // Pure white sidebar
const SB_BORDER = '#E8E4FF'   // Lavender border (divisions)
const SB_HOVER  = '#F5F2FF'   // Light lavender hover
const SB_ACTIVE = '#EDE9FF'   // Lavender mist (active step)
const SB_DIM    = '#9CA3AF'   // Cool grey
const SB_MID    = '#4B5275'   // Mid purple-grey
const SB_ON     = '#13111E'   // Deep ink (active text)
const SB_WHITE  = '#13111E'   // (renamed: now deep ink, kept name for compat)
const SB_LABEL  = '#8B87AD'   // Group label
const SB_ACCENT = '#7C6FE0'   // Lavender

// ── Main ─────────────────────────────────────────────────────
export function WizardPage() {
  const { step, setStep } = useTimetableStore()
  const { isAuthenticated, user } = useAuthStore()
  const CurrentStep = STEPS[step - 1] ?? StepStructure
  const total = STEPS.length
  const pct   = Math.round(((step - 1) / (total - 1)) * 100)

  return (
    <div style={{ display:"flex", height:"calc(100vh - 52px)", overflow:"hidden" }}>

      {/* ═══════════════════════════════════
          DARK SIDEBAR
      ═══════════════════════════════════ */}
      <aside style={{
        width: 240, flexShrink: 0,
        background: SB_BG, borderRight: `1px solid ${SB_BORDER}`,
        display: "flex", flexDirection: "column",
      }}>

        {/* School / user info */}
        <div style={{ padding: "14px 16px", borderBottom: `1px solid ${SB_BORDER}` }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: SB_DIM, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>
            Setup Wizard
          </div>
          <div style={{ fontSize: 13, color: SB_WHITE, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {isAuthenticated && user ? (user.schoolName || user.name) : "New School"}
          </div>
          <div style={{ fontSize: 10, color: SB_DIM, marginTop: 3 }}>
            Step {step} of {total}
          </div>
        </div>

        {/* Steps list */}
        <nav style={{ flex: 1, padding: "10px 0" }}>
          {STEP_META.map((s, i) => {
            const n      = i + 1
            const active = step === n
            const done   = step > n
            const future = step < n

            return (
              <div key={n}>
                <button
                  onClick={() => done && setStep(n)}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", gap: 12,
                    padding: "10px 16px", border: "none", textAlign: "left",
                    borderLeft: active ? `3px solid ${s.color}` : "3px solid transparent",
                    background: active ? SB_ACTIVE : "transparent",
                    cursor: done ? "pointer" : "default",
                    transition: "background 0.12s",
                  }}
                  onMouseEnter={e => { if (done) (e.currentTarget as HTMLButtonElement).style.background = SB_HOVER }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = active ? SB_ACTIVE : "transparent" }}
                >
                  {/* Circle indicator */}
                  <div style={{
                    width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: done ? SB_ACCENT : active ? s.color : "#F0EDFF",
                    border: future ? `1.5px solid ${SB_BORDER}` : "none",
                    transition: "background 0.2s",
                  }}>
                    {done
                      ? <CheckCircle2 size={13} color="#fff" />
                      : <span style={{ fontSize: 11, fontWeight: 700, color: active ? "#fff" : SB_DIM }}>{n}</span>}
                  </div>

                  {/* Text */}
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      fontSize: 12, fontWeight: active ? 600 : 400,
                      color: active ? SB_WHITE : done ? SB_ON : SB_DIM,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {s.label}
                    </div>
                    <div style={{ fontSize: 10, color: active ? SB_MID : SB_DIM, marginTop: 2 }}>
                      {s.sub}
                    </div>
                  </div>
                </button>

                {/* Connector */}
                {i < total - 1 && (
                  <div style={{
                    width: 1.5, height: 8, marginLeft: 27, marginTop: 1, marginBottom: 1,
                    background: done ? SB_ACCENT : SB_BORDER,
                    transition: "background 0.3s",
                  }} />
                )}
              </div>
            )
          })}
        </nav>

        {/* Progress bar */}
        <div style={{ padding: "14px 16px", borderTop: `1px solid ${SB_BORDER}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 10, color: SB_DIM }}>Progress</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: pct === 100 ? "#9B8EF5" : SB_MID }}>{pct}% complete</span>
          </div>
          <div style={{ height: 4, background: SB_BORDER, borderRadius: 2, overflow: "hidden" }}>
            <div style={{
              height: "100%", borderRadius: 2, transition: "width 0.35s ease",
              background: pct === 100 ? SB_ACCENT : "linear-gradient(90deg, #7C6FE0, #9B8EF5)",
              width: `${pct}%`,
            }} />
          </div>
        </div>
      </aside>

      {/* ═══════════════════════════════════
          CONTENT AREA
      ═══════════════════════════════════ */}
      <div style={{ flex: 1, overflowY: "auto", background: "#F9F8FF", display: "flex", flexDirection: "column" }}>

        {/* ── Sticky sub-header bar ── */}
        <div style={{
          height: 48, background: "#fff", borderBottom: "1px solid #e5e7eb",
          display: "flex", alignItems: "center", padding: "0 28px",
          position: "sticky", top: 0, zIndex: 10, gap: 12,
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 20, flexShrink: 0 }}>{STEP_META[step - 1]?.icon}</span>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>
              {STEP_META[step - 1]?.label}
            </span>
            <span style={{ fontSize: 12, color: "#9ca3af", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              — {STEP_META[step - 1]?.sub}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} />
            <span style={{ fontSize: 11, color: "#6b7280" }}>Auto-saved</span>
          </div>
        </div>

        {/* ── Step content ── */}
        <div style={{ padding: "24px 28px", flex: 1 }}>
          <StepErrorBoundary step={step}>
            <CurrentStep />
          </StepErrorBoundary>
        </div>
      </div>
    </div>
  )
}
