import { useState, useEffect, useRef } from "react"
import { useTimetableStore } from "@/store/timetableStore"
import { useTerminology } from "@/hooks/useTerminology"
import { buildPeriodSequence } from "@/lib/aiEngine"
import { solveTimetable, generateSuggestions, durationToWeeklyPeriods } from "@/lib/schedulingEngine"
import { ReviewDashboard } from "@/components/master/ReviewDashboard"
import { getCountry } from "@/lib/orgData"

type JobStatus = "idle" | "running" | "completed" | "failed"

interface Job {
  id: string
  status: JobStatus
  progress: number
  currentStep: string
  startedAt?: number
}

// Each step: progress % it animates to + a short human label
const STEPS = [
  { pct:  8, label: "Reading school setup…" },
  { pct: 18, label: "Mapping lesson slots across the week…" },
  { pct: 30, label: "Matching teachers to subjects…" },
  { pct: 42, label: "Pairing every subject with a teacher…" },
  { pct: 55, label: "Building the weekly schedule…" },
  { pct: 65, label: "Ensuring no teacher is double-booked…" },
  { pct: 75, label: "Balancing workload across all classes…" },
  { pct: 83, label: "Spreading subjects evenly across the week…" },
  { pct: 90, label: "Checking for conflicts and gaps…" },
  { pct: 95, label: "Validating all constraints…" },
  { pct: 98, label: "Building class and teacher views…" },
]

// Default academic year boundaries
function defaultStartDate(): string {
  const now = new Date()
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  return `${year}-06-01`
}
function defaultEndDate(): string {
  const now = new Date()
  const year = now.getMonth() >= 3 ? now.getFullYear() + 1 : now.getFullYear()
  return `${year}-03-31`
}

export function Step6Generate() {
  const store = useTimetableStore()
  const { config, sections, participantPools, facilities, subjects, breaks,
          setPeriods, setClassTT, setTeacherTT, setConflicts, setSuggestions,
          setStep, setConfig, setTimetableStatus } = store
  const T = useTerminology()
  const [job, setJob] = useState<Job | null>(null)
  const [solverOutput, setSolverOutput] = useState<ReturnType<typeof solveTimetable> | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Timetable identity — pre-filled with sensible defaults
  const [ttName, setTtName]         = useState(config.timetableName       || `${config.schoolName || "School"} Timetable`)
  const [ttStart, setTtStart]       = useState(config.timetableStartDate  || defaultStartDate())
  const [ttEnd, setTtEnd]           = useState(config.timetableEndDate    || defaultEndDate())

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  const totalParticipants = participantPools.reduce((a, p) => a + p.participantCount, 0)

  // ── Stats for the info cards ──────────────────────────────────
  const stats = [
    { icon:"🏫", label:"Classes",  value: sections.length },
    { icon:"👩‍🏫", label:"Teachers", value: store.staff.length },
    { icon:"📖", label:"Subjects",  value: subjects.length },
    { icon:"🚪", label:"Rooms",     value: facilities.length || sections.length },
    { icon:"📅", label:"Days/week", value: config.workDays?.length ?? 5 },
    { icon:"⏰", label:"Periods/day",value: config.periodsPerDay ?? 8 },
  ]

  // ── Start generation ─────────────────────────────────────────
  const startGenerate = () => {
    // Persist timetable identity into config before running
    setConfig({ timetableName: ttName.trim() || "My Timetable", timetableStartDate: ttStart, timetableEndDate: ttEnd })
    setTimetableStatus('generating')

    const jobId    = crypto.randomUUID()
    const startedAt = Date.now()
    setJob({ id: jobId, status: "running", progress: 3, currentStep: "Starting…", startedAt })

    let output: ReturnType<typeof solveTimetable>
    let solveMs: number

    try {
      const workDays = config.workDays?.length ? config.workDays : ['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY']
      const periods  = buildPeriodSequence(breaks, config.periodsPerDay ?? 8)

      const resolvedSubjects = store.schedulingMode === 'duration-based'
        ? subjects.map(sub => {
            const rh = (sub as any).requiredHours
            if (!rh) return sub
            const weekly = durationToWeeklyPeriods({
              subjectName: sub.name, className: 'all',
              requiredHours: rh,
              periodDurationMins: (sub as any).sessionDuration ?? 45,
              workingDaysPerYear: store.workingDaysPerYear ?? 220,
              workingDaysPerWeek: workDays.length,
            })
            return { ...sub, periodsPerWeek: weekly }
          })
        : subjects

      const staff = store.staff
      const optionalBlocks      = (store as any).optionalBlocks ?? []
      const subjectCombinations = (store as any).subjectCombinations ?? []
      const sectionStrengths    = (store as any).sectionStrengths ?? []
      const subjectAllocations  = (store as any).subjectAllocations ?? {}
      const rooms                = (store as any).rooms ?? []
      output  = solveTimetable({
        sections, staff, subjects: resolvedSubjects, periods, workDays,
        requirements: [],
        optionalBlocks,
        subjectCombinations,
        sectionStrengths,
        subjectAllocations,
        rooms,
      })
      solveMs = Date.now() - startedAt

      const suggestions = generateSuggestions(output.classTT, output.teacherTT, staff, resolvedSubjects, workDays, periods)
      setPeriods(periods)
      setClassTT(output.classTT)
      setTeacherTT(output.teacherTT)
      setConflicts(output.conflicts)
      setSolverOutput(output)
      // Persist blocked-slot telemetry to the store so any view (timetable
      // cells, dashboard, conflict panel) can surface "why is this empty?"
      ;(store as any).setBlockedSlots?.(output.blockedSlots ?? [])
      setSuggestions(suggestions)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setJob(j => j ? { ...j, status: "failed", progress: 0, currentStep: `Error: ${msg}` } : j)
      return
    }

    // ── Animate progress through STEPS at 110ms each ──
    let step = 0
    pollRef.current = setInterval(() => {
      if (step >= STEPS.length) {
        clearInterval(pollRef.current!)
        setTimetableStatus('draft')   // saved as draft — user must publish
        const conflicts = output.conflicts.length
        setJob(j => j ? {
          ...j, status: "completed", progress: 100,
          currentStep: conflicts > 0
            ? `Done — ${conflicts} conflict(s) found, review in timetable`
            : `Done in ${solveMs}ms — zero conflicts ✅`,
        } : j)
        return
      }
      const idx = step
      setJob(j => j ? { ...j, progress: STEPS[idx].pct, currentStep: STEPS[idx].label } : j)
      step++
    }, 110)
  }

  // ── Circular SVG ring ─────────────────────────────────────────
  const R   = 54
  const circ = 2 * Math.PI * R   // ≈ 339
  const progress = job?.progress ?? 0
  const dashOffset = circ * (1 - progress / 100)

  const ringColor =
    job?.status === "completed" ? "#7C6FE0" :
    job?.status === "failed"    ? "#dc2626" : "#7C6FE0"

  const elapsed = job?.startedAt ? ((Date.now() - job.startedAt) / 1000).toFixed(1) : "0.0"

  return (
    <div style={{ display:"flex", flexDirection:"column" as const, alignItems:"center", minHeight:"70vh", gap:28, padding:"40px 24px", textAlign:"center" as const }}>

      <style>{`
        @keyframes spin-ring { to { transform: rotate(360deg) } }
        @keyframes fade-up   { from { opacity:0; transform:translateY(10px) } to { opacity:1; transform:translateY(0) } }
        @keyframes pulse-dot { 0%,100%{opacity:1} 50%{opacity:0.25} }
      `}</style>

      {/* ── Title ── */}
      <div style={{ animation:"fade-up 0.4s ease" }}>
        <h2 style={{ fontFamily:"'DM Serif Display',Georgia,serif", fontSize:28, margin:"0 0 4px" }}>
          {!job                       ? `Ready to generate your ${T.schedule.toLowerCase()}` :
           job.status === "running"   ? `Building your ${T.schedule.toLowerCase()}…` :
           job.status === "completed" ? `${T.schedule} is ready! 🎉` :
           "Something went wrong"}
        </h2>
        {job && (
          <p style={{ fontSize:12, color:"#a8a59e", margin:0, fontFamily:"monospace" }}>
            Job {job.id.slice(0,8)}
            {job.status === "running" && ` · ${elapsed}s`}
          </p>
        )}
      </div>

      {/* ── Progress ring + percentage ── */}
      {job && (
        <div style={{ position:"relative", width:148, height:148, animation:"fade-up 0.4s ease 0.1s both" }}>
          {/* Background track */}
          <svg width="148" height="148" style={{ position:"absolute", top:0, left:0 }}>
            <circle cx="74" cy="74" r={R} fill="none" stroke="#f0efeb" strokeWidth="10"/>
          </svg>

          {/* Spinning halo while running */}
          {job.status === "running" && (
            <svg width="148" height="148"
              style={{ position:"absolute", top:0, left:0, animation:"spin-ring 2s linear infinite" }}>
              <circle cx="74" cy="74" r={R} fill="none"
                stroke="url(#grad)" strokeWidth="10"
                strokeDasharray={`${circ * 0.15} ${circ * 0.85}`}
                strokeLinecap="round"/>
              <defs>
                <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#818cf8" stopOpacity="0"/>
                  <stop offset="100%" stopColor="#7C6FE0"/>
                </linearGradient>
              </defs>
            </svg>
          )}

          {/* Filled arc */}
          <svg width="148" height="148" style={{ position:"absolute", top:0, left:0 }}>
            <circle cx="74" cy="74" r={R} fill="none"
              stroke={ringColor} strokeWidth="10"
              strokeDasharray={circ}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
              transform="rotate(-90 74 74)"
              style={{ transition:"stroke-dashoffset 0.5s ease, stroke 0.3s" }}/>
          </svg>

          {/* Centre content */}
          <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column" as const, alignItems:"center", justifyContent:"center" }}>
            {job.status === "completed" ? (
              <span style={{ fontSize:36 }}>✅</span>
            ) : job.status === "failed" ? (
              <span style={{ fontSize:36 }}>❌</span>
            ) : (
              <>
                <span style={{ fontSize:30, fontWeight:800, fontFamily:"'DM Mono',monospace", color:"#1c1b18", lineHeight:1 }}>
                  {progress}
                </span>
                <span style={{ fontSize:12, color:"#a8a59e", fontWeight:600 }}>%</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Current step label ── */}
      {job && (
        <div key={job.currentStep}
          style={{ animation:"fade-up 0.3s ease", fontSize:14, color: job.status==="failed"?"#dc2626": job.status==="completed"?"#7C6FE0":"#374151", fontWeight:500, maxWidth:420, lineHeight:1.5 }}>
          {job.status === "running" && (
            <span style={{ display:"inline-block", width:8, height:8, borderRadius:"50%", background:"#7C6FE0", marginRight:8, animation:"pulse-dot 1s ease-in-out infinite", verticalAlign:"middle" }}/>
          )}
          {job.currentStep}
        </div>
      )}

      {/* ── Stats cards ── */}
      <div style={{ display:"flex", gap:10, flexWrap:"wrap" as const, justifyContent:"center", maxWidth:520, animation:"fade-up 0.4s ease 0.2s both" }}>
        {stats.map((s, i) => (
          <div key={s.label} style={{
            display:"flex", flexDirection:"column" as const, alignItems:"center", gap:3,
            padding:"12px 16px", borderRadius:12,
            background: job?.status==="completed" ? "#f0fdf4" : "#f7f6f2",
            border: `1.5px solid ${job?.status==="completed" ? "#D8D2FF" : "#e8e5de"}`,
            minWidth:72,
            transition:"all 0.3s ease",
            animationDelay: `${0.3 + i * 0.05}s`,
          }}>
            <span style={{ fontSize:20 }}>{s.icon}</span>
            <span style={{ fontSize:22, fontWeight:800, fontFamily:"'DM Mono',monospace", color:"#1c1b18", lineHeight:1 }}>{s.value}</span>
            <span style={{ fontSize:10, color:"#a8a59e", fontWeight:600, textTransform:"uppercase" as const, letterSpacing:"0.05em" }}>{s.label}</span>
          </div>
        ))}
      </div>

      {/* ── Timetable identity form (shown before generate) ── */}
      {!job && (
        <div style={{ width:"100%", maxWidth:460, background:"#f7f6f2", borderRadius:12, border:"1.5px solid #e8e5de", padding:"20px 24px", animation:"fade-up 0.4s ease 0.25s both", textAlign:"left" as const }}>
          <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase" as const, letterSpacing:"0.08em", color:"#a8a59e", marginBottom:14 }}>📋 Timetable Details</div>
          <div style={{ display:"flex", flexDirection:"column" as const, gap:12 }}>

            {/* Name */}
            <div>
              <label style={{ fontSize:11, fontWeight:600, color:"#374151", display:"block", marginBottom:4 }}>Timetable Name</label>
              <input
                value={ttName} onChange={e => setTtName(e.target.value)}
                placeholder="e.g. Annual Timetable 2025-26"
                style={{ width:"100%", padding:"9px 12px", border:"1.5px solid #e8e5de", borderRadius:8, fontSize:13, outline:"none", boxSizing:"border-box" as const, background:"#fff" }}
              />
            </div>

            {/* Dates */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              <div>
                <label style={{ fontSize:11, fontWeight:600, color:"#374151", display:"block", marginBottom:4 }}>Start Date</label>
                <input
                  type="date" value={ttStart} onChange={e => setTtStart(e.target.value)}
                  style={{ width:"100%", padding:"8px 10px", border:"1.5px solid #e8e5de", borderRadius:8, fontSize:12, outline:"none", boxSizing:"border-box" as const, background:"#fff", cursor:"pointer" }}
                />
              </div>
              <div>
                <label style={{ fontSize:11, fontWeight:600, color:"#374151", display:"block", marginBottom:4 }}>End Date</label>
                <input
                  type="date" value={ttEnd} onChange={e => setTtEnd(e.target.value)}
                  style={{ width:"100%", padding:"8px 10px", border:"1.5px solid #e8e5de", borderRadius:8, fontSize:12, outline:"none", boxSizing:"border-box" as const, background:"#fff", cursor:"pointer" }}
                />
              </div>
            </div>

            <div style={{ fontSize:10, color:"#a8a59e", display:"flex", alignItems:"center", gap:6 }}>
              <span style={{ fontSize:14 }}>💡</span>
              The timetable is saved as a <strong>Draft</strong> after generation. Review it, then publish when ready.
            </div>
          </div>
        </div>
      )}

      {/* ── Review dashboard (post-generation analytics) ── */}
      {job?.status === 'completed' && solverOutput && (
        <div style={{ width: '100%', animation: 'fade-up 0.4s ease 0.2s both' }}>
          <ReviewDashboard
            classTT={solverOutput.classTT}
            sections={store.sections}
            staff={store.staff}
            subjects={store.subjects}
            periods={store.periods}
            workDays={store.config?.workDays ?? []}
            optionalBlocks={solverOutput.optionalBlocks ?? []}
            teacherWeeklyLoad={solverOutput.teacherWeeklyLoad}
            teacherLoadStddev={solverOutput.teacherLoadStddev}
            conflicts={solverOutput.conflicts}
            penalties={solverOutput.penalties}
            rooms={(store as any).rooms ?? []}
            score={solverOutput.score}
            blockedSlots={solverOutput.blockedSlots}
          />
        </div>
      )}

      {/* ── CTA buttons ── */}
      <div style={{ display:"flex", gap:10, flexWrap:"wrap" as const, justifyContent:"center", animation:"fade-up 0.4s ease 0.35s both" }}>
        {!job && (
          <>
            <button onClick={startGenerate}
              style={{ display:"flex", alignItems:"center", gap:8, padding:"13px 36px", borderRadius:10, border:"none", background:"#7C6FE0", color:"#fff", fontSize:15, fontWeight:700, cursor:"pointer", boxShadow:"0 4px 20px rgba(79,70,229,0.35)" }}>
              ✨ Generate {T.schedule}
            </button>
            <button onClick={() => setStep(3)}
              style={{ padding:"13px 20px", borderRadius:10, border:"1.5px solid #e8e5de", background:"#fff", fontSize:13, color:"#374151", cursor:"pointer" }}>
              ← Back
            </button>
          </>
        )}

        {job?.status === "completed" && (
          <>
            <button onClick={() => window.location.href='/timetable'}
              style={{ padding:"13px 32px", borderRadius:10, border:"none", background:"#7C6FE0", color:"#fff", fontSize:15, fontWeight:700, cursor:"pointer", boxShadow:"0 4px 20px rgba(124,111,224,0.3)" }}>
              View {T.schedule} (Draft) →
            </button>
            <button onClick={() => setJob(null)}
              style={{ padding:"13px 18px", borderRadius:10, border:"1.5px solid #e8e5de", background:"#fff", fontSize:13, color:"#374151", cursor:"pointer" }}>
              ↺ Re-generate
            </button>
          </>
        )}

        {job?.status === "failed" && (
          <button onClick={() => setJob(null)}
            style={{ padding:"13px 22px", borderRadius:10, border:"none", background:"#dc2626", color:"#fff", fontSize:13, fontWeight:600, cursor:"pointer" }}>
            Try Again
          </button>
        )}
      </div>
    </div>
  )
}
