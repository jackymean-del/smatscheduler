import { useState, useMemo } from "react"
import { useTimetableStore } from "@/store/timetableStore"
import { ORG_CONFIGS } from "@/lib/orgData"
import { rebuildTeacherTT } from "@/lib/aiEngine"
import { detectConflicts } from "@/lib/schedulingEngine"

interface Props {
  target: { section: string; day: string; periodId: string }
  onClose: () => void
  /** Pre-selected subject (from period pool drag-and-drop) */
  initialSubject?: string
}

const DAY_LABEL: Record<string, string> = {
  MONDAY: "Monday", TUESDAY: "Tuesday", WEDNESDAY: "Wednesday",
  THURSDAY: "Thursday", FRIDAY: "Friday", SATURDAY: "Saturday", SUNDAY: "Sunday",
}

// 8-colour palette for subject pills — cycles via index
const SUBJECT_COLORS = [
  { bg: "#EDE9FF", border: "#D8D2FF", text: "#4338ca" },  // indigo
  { bg: "#fef3c7", border: "#fcd34d", text: "#92400e" },  // amber
  { bg: "#ecfdf5", border: "#6ee7b7", text: "#065f46" },  // emerald
  { bg: "#fdf2f8", border: "#f9a8d4", text: "#9d174d" },  // pink
  { bg: "#eff6ff", border: "#93c5fd", text: "#1e40af" },  // blue
  { bg: "#fff7ed", border: "#fdba74", text: "#9a3412" },  // orange
  { bg: "#f5f3ff", border: "#c4b5fd", text: "#5b21b6" },  // violet
  { bg: "#ecfeff", border: "#67e8f9", text: "#164e63" },  // cyan
]

export function EditCellModal({ target, onClose, initialSubject }: Props) {
  const {
    config, classTT, staff, subjects, sections, periods, facilities,
    updateCell, setTeacherTT, setConflicts,
  } = useTimetableStore()
  const org = ORG_CONFIGS[config.orgType ?? "school"]

  const cell       = classTT[target.section]?.[target.day]?.[target.periodId] ?? {}
  const section    = sections.find(s => s.name === target.section)
  const periodObj  = periods.find(p => p.id === target.periodId)

  // When dragged from the Period Pool, `initialSubject` pre-selects the subject.
  const [selectedSubject, setSelectedSubject] = useState(cell.subject || initialSubject || "")
  const [selectedTeacher, setSelectedTeacher] = useState(cell.teacher || "")
  const [selectedRoom,    setSelectedRoom]    = useState(cell.room    || "")

  // ── Subjects that apply to this section ────────────────────────
  const sectionSubjects = useMemo(() =>
    subjects.filter(sub => {
      const secs = sub.sections ?? []
      return secs.length === 0 || secs.includes(target.section)
    }),
    [subjects, target.section]
  )

  // ── Teacher eligibility helper ──────────────────────────────────
  // Returns all staff with:
  //   .match         — teaches this subject for this section (or globally)
  //   .conflictSection — name of the other section where they're already booked
  const getEligibleTeachers = (subjectName: string) => {
    const sectionKey = `${target.section}::${subjectName}`
    return staff
      .map(st => {
        const subs: string[] = st.subjects ?? []
        const hasSectionSpecific = subs.some(s => s.includes("::"))
        let match = false
        if (hasSectionSpecific) {
          // Has class-specific assignments — must match by section or grade
          match = subs.some(s => s === sectionKey || s.endsWith(`::${subjectName}`))
        } else {
          // Global assignments
          match = subjectName ? subs.includes(subjectName) : false
        }

        // Detect double-booking at this exact slot
        const conflictSection =
          Object.keys(classTT).find(sec => {
            if (sec === target.section) return false
            return classTT[sec]?.[target.day]?.[target.periodId]?.teacher === st.name
          }) ?? null

        return { ...st, match, conflictSection }
      })
      .sort((a, b) => {
        // Best first: subject match, then no conflict, then name
        if (a.match !== b.match)                       return a.match ? -1 : 1
        if (!!a.conflictSection !== !!b.conflictSection) return a.conflictSection ? 1 : -1
        return a.name.localeCompare(b.name)
      })
  }

  // Current teacher list for selected subject
  const eligibleTeachers = useMemo(
    () => getEligibleTeachers(selectedSubject),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedSubject, staff, classTT, target.section, target.day, target.periodId]
  )

  // Conflict warning for the currently selected teacher
  const conflictWith = useMemo(() => {
    if (!selectedTeacher) return null
    return (
      Object.keys(classTT).find(sec => {
        if (sec === target.section) return false
        return classTT[sec]?.[target.day]?.[target.periodId]?.teacher === selectedTeacher
      }) ?? null
    )
  }, [selectedTeacher, classTT, target])

  // Room options — section default first, then all facilities / other section rooms
  const roomOptions = useMemo(() => {
    const seen = new Set<string>()
    const opts: string[] = []
    const add = (r?: string) => { if (r && !seen.has(r)) { seen.add(r); opts.push(r) } }
    add(section?.room)
    facilities.forEach(f => add(f.actualName || f.generatedName))
    sections.forEach(s => add(s.room))
    return opts
  }, [section, facilities, sections])

  // ── Bidirectional auto-fill ─────────────────────────────────────

  const handleSubjectChange = (subjectName: string) => {
    setSelectedSubject(subjectName)
    if (!subjectName) return
    // Auto-fill best available teacher
    const eligible = getEligibleTeachers(subjectName)
    const best =
      eligible.find(t => t.match && !t.conflictSection) ??
      eligible.find(t => !t.conflictSection) ??
      null
    if (best) setSelectedTeacher(best.name)
    // Auto-fill room from section default
    if (section?.room) setSelectedRoom(section.room)
  }

  const handleTeacherChange = (teacherName: string) => {
    setSelectedTeacher(teacherName)
    // Auto-fill subject if none selected yet
    if (!selectedSubject && teacherName) {
      const st = staff.find(s => s.name === teacherName)
      if (st) {
        const subs: string[] = st.subjects ?? []
        // Prefer section-specific assignment
        const secSpecific = subs.find(s => s.startsWith(`${target.section}::`))
        if (secSpecific) {
          const subName = secSpecific.replace(/.*::/, "")
          if (sectionSubjects.find(s => s.name === subName)) {
            setSelectedSubject(subName)
          }
        }
      }
    }
    // Auto-fill room if empty
    if (!selectedRoom && section?.room) setSelectedRoom(section.room)
  }

  // ── Persist helpers ─────────────────────────────────────────────

  const commitAndRebuild = (cellPatch: { subject: string; teacher: string; room: string }) => {
    updateCell(target.section, target.day, target.periodId, cellPatch)
    // Zustand set is synchronous — getState() reflects the update immediately
    const freshState = useTimetableStore.getState()
    const newTeacherTT = JSON.parse(JSON.stringify(freshState.teacherTT))
    rebuildTeacherTT(freshState.classTT, newTeacherTT, freshState.config.workDays)
    setTeacherTT(newTeacherTT)
    setConflicts(detectConflicts(freshState.classTT, freshState.periods))
    onClose()
  }

  const save = () =>
    commitAndRebuild({ subject: selectedSubject, teacher: selectedTeacher, room: selectedRoom })

  const clearPeriod = () =>
    commitAndRebuild({ subject: "", teacher: "", room: "" })

  const isDirty =
    selectedSubject !== (cell.subject ?? "") ||
    selectedTeacher !== (cell.teacher ?? "") ||
    selectedRoom    !== (cell.room    ?? "")

  const canSave = isDirty && (!!selectedSubject || !!selectedTeacher)

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div
      style={{
        position: "fixed" as const, inset: 0,
        background: "rgba(0,0,0,0.42)",
        display: "flex", alignItems: "flex-start", justifyContent: "flex-end",
        zIndex: 1000, padding: 12,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        width: 480, background: "#fff", borderRadius: 14,
        boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
        display: "flex", flexDirection: "column" as const,
        maxHeight: "calc(100vh - 24px)", overflow: "hidden",
        animation: "ecmSlideIn 0.2s ease",
      }}>
        <style>{`
          @keyframes ecmSlideIn {
            from { opacity: 0; transform: translateX(24px) }
            to   { opacity: 1; transform: translateX(0) }
          }
        `}</style>

        {/* ── Header ── */}
        <div style={{
          padding: "16px 20px", borderBottom: "1px solid #e2e8f0",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#1e293b", display: "flex", alignItems: "center", gap: 8 }}>
              ✏️ Edit Period
            </div>
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 3, fontFamily: "monospace" }}>
              <span style={{ color: "#7C6FE0", fontWeight: 600 }}>{target.section}</span>
              {" · "}{DAY_LABEL[target.day] ?? target.day}
              {" · "}{periodObj?.name ?? target.periodId}
            </div>
          </div>
          <button onClick={onClose} style={{
            width: 28, height: 28, borderRadius: "50%",
            border: "1px solid #e2e8f0", background: "#f8fafc",
            cursor: "pointer", display: "flex", alignItems: "center",
            justifyContent: "center", fontSize: 14, color: "#64748b",
          }}>✕</button>
        </div>

        {/* ── Scrollable body ── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column" as const, gap: 18 }}>

          {/* ── Subject pills ── */}
          <div>
            <label style={{
              fontSize: 10, fontWeight: 700, textTransform: "uppercase" as const,
              letterSpacing: "0.08em", color: "#94a3b8", display: "block", marginBottom: 8,
            }}>
              {org.subjectLabel}
            </label>

            {sectionSubjects.length === 0 ? (
              <div style={{ fontSize: 12, color: "#94a3b8", fontStyle: "italic", padding: "8px 0" }}>
                No subjects configured for {target.section}.
              </div>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 7 }}>
                {sectionSubjects.map((sub, i) => {
                  const c = SUBJECT_COLORS[i % SUBJECT_COLORS.length]
                  const isSelected = selectedSubject === sub.name
                  return (
                    <button
                      key={sub.id ?? sub.name}
                      onClick={() => handleSubjectChange(isSelected ? "" : sub.name)}
                      style={{
                        padding: "6px 14px", borderRadius: 20,
                        border: `1.5px solid ${isSelected ? c.border : "#e2e8f0"}`,
                        background: isSelected ? c.bg : "#f8fafc",
                        color: isSelected ? c.text : "#64748b",
                        fontSize: 12, fontWeight: isSelected ? 700 : 400,
                        cursor: "pointer", transition: "all 0.12s",
                        boxShadow: isSelected ? `0 0 0 2px ${c.border}` : "none",
                      }}
                    >
                      {sub.name}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* ── Conflict warning ── */}
          {conflictWith && (
            <div style={{
              padding: "10px 14px", background: "#fef2f2",
              border: "1.5px solid #fca5a5", borderRadius: 8,
              display: "flex", alignItems: "flex-start", gap: 10,
            }}>
              <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>⚠️</span>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#dc2626" }}>Teacher Conflict Detected</div>
                <div style={{ fontSize: 11, color: "#ef4444", marginTop: 2, lineHeight: 1.5 }}>
                  <strong>{selectedTeacher}</strong> is already assigned to{" "}
                  <strong>{conflictWith}</strong> during this period.
                  Saving will create a double-booking.
                </div>
              </div>
            </div>
          )}

          {/* ── Teacher selector ── */}
          <div>
            <label style={{
              fontSize: 10, fontWeight: 700, textTransform: "uppercase" as const,
              letterSpacing: "0.08em", color: "#94a3b8", display: "block", marginBottom: 8,
            }}>
              {org.staffLabel}
            </label>
            <select
              value={selectedTeacher}
              onChange={e => handleTeacherChange(e.target.value)}
              style={{
                width: "100%", padding: "8px 12px",
                border: `1.5px solid ${conflictWith ? "#fca5a5" : selectedTeacher ? "#D8D2FF" : "#e2e8f0"}`,
                borderRadius: 8, fontSize: 12, outline: "none",
                background: "#fff", cursor: "pointer",
              }}
            >
              <option value="">— Select {org.staffLabel.toLowerCase()} —</option>
              {eligibleTeachers.map(t => (
                <option key={t.id ?? t.name} value={t.name}>
                  {t.match ? "★ " : "  "}
                  {t.name}
                  {t.role ? ` (${t.role})` : ""}
                  {t.match ? " — eligible" : ""}
                  {t.conflictSection ? ` ⚠ busy in ${t.conflictSection}` : ""}
                </option>
              ))}
              {eligibleTeachers.length === 0 && selectedSubject && (
                <option disabled>No teachers found for this subject</option>
              )}
            </select>

            {/* Hint row */}
            <div style={{ display: "flex", gap: 14, marginTop: 5 }}>
              <span style={{ fontSize: 10, color: "#94a3b8" }}>★ = eligible for this subject</span>
              <span style={{ fontSize: 10, color: "#f59e0b" }}>⚠ = already booked this period</span>
            </div>
          </div>

          {/* ── Room selector ── */}
          <div>
            <label style={{
              fontSize: 10, fontWeight: 700, textTransform: "uppercase" as const,
              letterSpacing: "0.08em", color: "#94a3b8", display: "block", marginBottom: 8,
            }}>
              Room
            </label>
            {roomOptions.length > 0 ? (
              <select
                value={selectedRoom}
                onChange={e => setSelectedRoom(e.target.value)}
                style={{
                  width: "100%", padding: "8px 12px",
                  border: `1.5px solid ${selectedRoom ? "#e2e8f0" : "#e2e8f0"}`,
                  borderRadius: 8, fontSize: 12, outline: "none",
                  background: "#fff", cursor: "pointer",
                }}
              >
                <option value="">— Select room —</option>
                {roomOptions.map(r => (
                  <option key={r} value={r}>
                    {r}{section?.room === r ? " (class default)" : ""}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={selectedRoom}
                onChange={e => setSelectedRoom(e.target.value)}
                placeholder="Room number or name"
                style={{
                  width: "100%", padding: "8px 12px",
                  border: "1.5px solid #e2e8f0", borderRadius: 8,
                  fontSize: 12, outline: "none", boxSizing: "border-box" as const,
                }}
              />
            )}
          </div>

          {/* ── Assignment preview card ── */}
          {(selectedSubject || selectedTeacher || selectedRoom) && (
            <div style={{
              padding: "12px 14px", background: "#f8fafc",
              border: "1.5px solid #e2e8f0", borderRadius: 9,
            }}>
              <div style={{
                fontSize: 10, fontWeight: 700, textTransform: "uppercase" as const,
                letterSpacing: "0.08em", color: "#94a3b8", marginBottom: 8,
              }}>
                Assignment Preview
              </div>
              <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 6 }}>
                {selectedSubject && (
                  <span style={{
                    fontSize: 11, background: "#EDE9FF", color: "#4338ca",
                    padding: "3px 10px", borderRadius: 5, fontWeight: 600,
                  }}>📚 {selectedSubject}</span>
                )}
                {selectedTeacher && (
                  <span style={{
                    fontSize: 11,
                    background: conflictWith ? "#fef2f2" : "#f0fdf4",
                    color: conflictWith ? "#dc2626" : "#166534",
                    padding: "3px 10px", borderRadius: 5, fontWeight: 600,
                  }}>👤 {selectedTeacher}</span>
                )}
                {selectedRoom && (
                  <span style={{
                    fontSize: 11, background: "#fff7ed", color: "#9a3412",
                    padding: "3px 10px", borderRadius: 5, fontWeight: 600,
                  }}>🚪 {selectedRoom}</span>
                )}
                {conflictWith && (
                  <span style={{
                    fontSize: 11, background: "#fef2f2", color: "#dc2626",
                    padding: "3px 10px", borderRadius: 5, fontWeight: 600,
                  }}>⚠️ Conflict: {conflictWith}</span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div style={{
          padding: "12px 20px", borderTop: "1px solid #e2e8f0",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          flexShrink: 0, gap: 8,
        }}>
          {/* Destructive: clear */}
          <button
            onClick={clearPeriod}
            title="Remove all assignments for this period"
            style={{
              padding: "8px 14px", borderRadius: 7,
              border: "1px solid #fca5a5", background: "#fef2f2",
              fontSize: 12, color: "#dc2626", fontWeight: 600, cursor: "pointer",
            }}
          >
            🗑️ Clear Period
          </button>

          {/* Cancel + Save */}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={onClose}
              style={{
                padding: "8px 18px", borderRadius: 7,
                border: "1px solid #e2e8f0", background: "#fff",
                fontSize: 12, color: "#64748b", cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={!canSave}
              style={{
                padding: "8px 22px", borderRadius: 7, border: "none",
                background: canSave ? (conflictWith ? "#D4920E" : "#7C6FE0") : "#e2e8f0",
                color: canSave ? "#fff" : "#94a3b8",
                fontSize: 12, fontWeight: 700,
                cursor: canSave ? "pointer" : "not-allowed",
                transition: "background 0.15s",
              }}
            >
              {conflictWith ? "⚠️ Save Anyway" : "✅ Save Changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
