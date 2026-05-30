import { useState } from "react"
import { useTimetableStore } from "@/store/timetableStore"
import { ORG_CONFIGS, getCountry } from "@/lib/orgData"

type Tab = "sections" | "subjects" | "staff" | "breaks"

const tdS: React.CSSProperties = { padding:"6px 8px", borderBottom:"1px solid #f0ede7", verticalAlign:"middle" }
const thS: React.CSSProperties = { padding:"8px 8px", background:"#f7f6f2", fontSize:10, fontWeight:700, textTransform:"uppercase" as const, letterSpacing:"0.06em", color:"#a8a59e", textAlign:"left" as const, borderBottom:"1px solid #e8e5de", whiteSpace:"nowrap" as const }
const inp = (extra?: React.CSSProperties): React.CSSProperties => ({ width:"100%", padding:"4px 6px", border:"1px solid transparent", borderRadius:5, fontSize:12, background:"transparent", outline:"none", ...extra })
const delBtn: React.CSSProperties = { width:24, height:24, borderRadius:4, border:"none", background:"transparent", cursor:"pointer", color:"#c8c5bc", fontSize:17 }
const addRow: React.CSSProperties = { width:"100%", padding:"8px 12px", border:"none", borderTop:"1.5px dashed #e8e5de", background:"transparent", cursor:"pointer", fontSize:12, color:"#a8a59e", textAlign:"left" as const }
const navBtn = (p: boolean): React.CSSProperties => ({ padding:"9px 18px", borderRadius:8, border: p?"none":"1.5px solid #e8e5de", background: p?"#7C6FE0":"#fff", color: p?"#fff":"#1c1b18", fontSize:13, fontWeight:600, cursor:"pointer" })

const SHIFT_COLORS = ['#7C6FE0','#7C6FE0','#D4920E','#dc2626','#9B8EF5','#7C6FE0']

export function Step5Data() {
  const { config, sections, staff, subjects, breaks,
          setSections, setStaff, setSubjects, setBreaks, setStep, setConfig } = useTimetableStore()
  const [tab, setTab] = useState<Tab>("sections")
  const org     = ORG_CONFIGS[config.orgType ?? "school"]
  const country = getCountry(config.countryCode ?? "IN")
  const hasShifts = config.shifts.length > 0

  // Unique base classes derived from section names
  const baseClasses = [...new Set(sections.map(s => {
    const m = s.name.match(/^(.+?)[-\s][A-E\d]$/i)
    return m ? m[1].trim() : s.name
  }))]

  const nextRoomNumber = () => {
    const used = sections.map(s => { const m = s.room?.match(/\d+/); return m ? parseInt(m[0]) : 0 })
    return (used.length ? Math.max(...used) : country.roomStart - 1) + 1
  }

  const TABS: { key: Tab; label: string }[] = [
    { key:"sections", label:`📚 ${org.sectionsLabel}` },
    { key:"subjects", label:`📖 ${org.subjectsLabel}` },
    { key:"staff",    label:`👤 ${org.staffsLabel}` },
    { key:"breaks",   label:"⏱ Breaks" },
  ]

  return (
    <div>
      <h1 style={{ fontFamily:"'DM Serif Display',Georgia,serif", fontSize:28, marginBottom:8 }}>Review & edit generated data</h1>
      <p style={{ color:"#6a6860", fontSize:13, marginBottom:14, lineHeight:1.65 }}>
        AI generated {sections.length} {org.sectionsLabel.toLowerCase()}, {staff.length} {org.staffsLabel.toLowerCase()}, {subjects.length} {org.subjectsLabel.toLowerCase()}. Edit anything inline.
      </p>
      <div style={{ background:"#eaecf8", borderLeft:"4px solid #7C6FE0", borderRadius:"0 8px 8px 0", padding:"8px 14px", marginBottom:18, fontSize:12, color:"#3730a3" }}>
        🪄 Click any field to edit. New rows auto-fill room numbers. Add or delete as needed.
      </div>

      {/* Tabs */}
      <div style={{ display:"flex", borderBottom:"2px solid #e8e5de", marginBottom:16 }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ padding:"8px 16px", border:"none", borderBottom: tab===t.key?"2px solid #7C6FE0":"2px solid transparent", marginBottom:-2, background:"transparent", fontSize:12, fontWeight: tab===t.key?700:500, color: tab===t.key?"#7C6FE0":"#6a6860", cursor:"pointer", whiteSpace:"nowrap" as const }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── CLASSES TAB ── */}
      {tab === "sections" && (
        <div style={{ border:"1.5px solid #e8e5de", borderRadius:12, overflow:"hidden" }}>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead><tr>
              <th style={{...thS, width:36}}>#</th>
              <th style={thS}>{org.sectionLabel}</th>
              <th style={{...thS, width:110}}>{org.roomLabel}</th>
              <th style={{...thS, width:90}}>Grade</th>
              {hasShifts && <th style={{...thS, width:140}}>Shift</th>}
              <th style={thS}>Class Teacher</th>
              <th style={{...thS, width:32}}></th>
            </tr></thead>
            <tbody>
              {sections.map((s, i) => (
                <tr key={s.id} style={{ background: i%2===0?"#fff":"#fafaf9" }}>
                  <td style={{...tdS, color:"#a8a59e", fontSize:10, fontFamily:"monospace"}}>{i+1}</td>
                  <td style={tdS}>
                    <input style={inp()} value={s.name}
                      onChange={e=>{
                        const name = e.target.value
                        const m = name.match(/^([IVXivx\d]+(?:\s+\d+)?)[-\s]/i) ?? name.match(/^([A-Za-z]+(?:\s+\d+)?)[-\s]/i)
                        const autoGrade = m ? m[1].trim() : s.grade
                        const n=[...sections]; n[i]={...n[i],name,grade:autoGrade}; setSections(n)
                      }} />
                  </td>
                  <td style={tdS}><input style={inp()} value={s.room??""} onChange={e=>{const n=[...sections];n[i]={...n[i],room:e.target.value};setSections(n)}} /></td>
                  <td style={tdS}><input style={inp()} value={s.grade??""} onChange={e=>{const n=[...sections];n[i]={...n[i],grade:e.target.value};setSections(n)}} /></td>
                  {hasShifts && (
                    <td style={tdS}>
                      <select style={{ fontSize:11, border:"1px solid #e8e5de", borderRadius:6, padding:"4px 6px", width:"100%", background:"#fff" }}
                        value={(s as any).shiftId??""} onChange={e=>{const n=[...sections];(n[i] as any).shiftId=e.target.value;setSections(n)}}>
                        <option value="">— No shift —</option>
                        {config.shifts.map((sh,si) => (
                          <option key={sh.id} value={sh.id}>
                            {sh.name} ({sh.startTime}–{sh.endTime})
                          </option>
                        ))}
                      </select>
                    </td>
                  )}
                  <td style={tdS}>
                    <select style={{ fontSize:11, border:"1px solid #e8e5de", borderRadius:6, padding:"4px 6px", width:"100%", background:"#fff" }}
                      value={s.classTeacher??""} onChange={e=>{const n=[...sections];n[i]={...n[i],classTeacher:e.target.value};setSections(n)}}>
                      <option value="">— None —</option>
                      {staff.map(st=><option key={st.id} value={st.name}>{st.name}</option>)}
                    </select>
                  </td>
                  <td style={tdS}><button style={delBtn} onClick={()=>setSections(sections.filter((_,j)=>j!==i))}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {hasShifts && (
            <div style={{ padding:"8px 12px", background:"#f7f6f2", borderTop:"1px solid #e8e5de", fontSize:11, color:"#6a6860" }}>
              🕐 Shifts defined: {config.shifts.map((s,i) => (
                <span key={s.id} style={{ marginRight:8, color:SHIFT_COLORS[i%SHIFT_COLORS.length], fontWeight:600 }}>
                  {s.name} ({s.startTime}–{s.endTime})
                </span>
              ))}
            </div>
          )}
          <button style={addRow} onClick={() => {
            setSections([...sections, { id:crypto.randomUUID(), name:`New ${org.sectionLabel}`, room:`${country.roomPrefix} ${nextRoomNumber()}`, grade:"", classTeacher:"" }])
          }}>
            ＋ Add {org.sectionLabel} (auto room: {country.roomPrefix} {nextRoomNumber()})
          </button>
        </div>
      )}

      {/* ── SUBJECTS TAB — Class-wise matrix ── */}
      {tab === "subjects" && (
        <div>
          {/* Global controls */}
          <div style={{ display:"flex", alignItems:"center", gap:16, padding:"10px 14px", background:"#f7f6f2", border:"1.5px solid #e8e5de", borderRadius:10, marginBottom:12, flexWrap:"wrap" as const }}>
            <span style={{ fontSize:12, color:"#374151", fontWeight:600 }}>Global defaults:</span>
            <label style={{ display:"flex", alignItems:"center", gap:6, fontSize:12, color:"#374151" }}>
              Duration
              <input type="number" min={10} max={120} defaultValue={config.defaultSessionDuration}
                onBlur={e => {
                  const dur = Math.max(10, +e.target.value)
                  setConfig({ defaultSessionDuration: dur })
                  setSubjects(subjects.map(s => ({ ...s, sessionDuration: dur } as any)))
                }}
                style={{ width:54, padding:"4px 6px", border:"1.5px solid #7C6FE0", borderRadius:6, fontSize:13, fontFamily:"monospace", textAlign:"center" as const, outline:"none" }} />
              <span style={{ color:"#6a6860" }}>min/period</span>
            </label>
            <span style={{ color:"#d1d5db" }}>|</span>
            <span style={{ fontSize:11, color:"#6a6860" }}>
              📋 Each subject row shows global defaults. Expand <strong>▸ Class-wise</strong> to override per class.
            </span>
          </div>

          {/* Class-wise matrix — scrollable horizontally */}
          <div style={{ border:"1.5px solid #e8e5de", borderRadius:12, overflow:"hidden" }}>
            <div style={{ overflowX:"auto" as const }}>
              <table style={{ width:"100%", borderCollapse:"collapse", minWidth: 500 + baseClasses.length * 160 }}>
                <thead>
                  <tr>
                    {/* Fixed subject info columns */}
                    <th style={{...thS, width:36, position:"sticky" as const, left:0, zIndex:2, background:"#f7f6f2"}}>#</th>
                    <th style={{...thS, minWidth:140, position:"sticky" as const, left:36, zIndex:2, background:"#f7f6f2"}}>Subject</th>
                    <th style={{...thS, width:76}}>Per./wk<br/><span style={{fontWeight:400,fontSize:9,color:"#b0ada6"}}>global</span></th>
                    <th style={{...thS, width:72}}>Min.<br/><span style={{fontWeight:400,fontSize:9,color:"#b0ada6"}}>global</span></th>
                    <th style={{...thS, width:64}}>Max/day<br/><span style={{fontWeight:400,fontSize:9,color:"#b0ada6"}}>global</span></th>
                    {/* One column per base class */}
                    {baseClasses.map(cls => (
                      <th key={cls} style={{...thS, minWidth:155, background:"#f0f0ff", color:"#3730a3", borderLeft:"2px solid #D8D2FF"}}>
                        <div style={{ fontSize:11, fontWeight:700 }}>{cls}</div>
                        <div style={{ fontSize:9, fontWeight:400, color:"#818cf8", marginTop:1 }}>Per/wk · Min · Max/day</div>
                      </th>
                    ))}
                    <th style={{...thS, width:32}}></th>
                  </tr>
                </thead>
                <tbody>
                  {subjects.map((s, i) => {
                    const dur     = (s as any).sessionDuration ?? 40
                    const maxDay  = (s as any).maxPeriodsPerDay ?? 2
                    const totalH  = Math.round(s.periodsPerWeek * dur / 60 * 10) / 10
                    return (
                      <tr key={s.id} style={{ background: i%2===0?"#fff":"#fafaf9" }}>
                        {/* # */}
                        <td style={{...tdS, color:"#a8a59e", fontSize:10, fontFamily:"monospace", position:"sticky" as const, left:0, background: i%2===0?"#fff":"#fafaf9", zIndex:1}}>{i+1}</td>
                        {/* Subject name */}
                        <td style={{...tdS, position:"sticky" as const, left:36, background: i%2===0?"#fff":"#fafaf9", zIndex:1}}>
                          <input style={inp({ fontWeight:600 })} value={s.name}
                            onChange={e=>{const n=[...subjects];n[i]={...n[i],name:e.target.value};setSubjects(n)}} />
                          <div style={{ fontSize:10, color:"#7C6FE0", fontFamily:"monospace", marginTop:1 }}>{totalH}h/wk</div>
                        </td>
                        {/* Global periods/week */}
                        <td style={tdS}>
                          <input type="number" min={1} max={30}
                            style={{ width:48, padding:"3px 5px", border:"1px solid #e8e5de", borderRadius:5, fontSize:12, fontFamily:"monospace", textAlign:"center" as const, outline:"none" }}
                            value={s.periodsPerWeek}
                            onChange={e=>{const n=[...subjects];n[i]={...n[i],periodsPerWeek:Math.max(1,+e.target.value)};setSubjects(n)}} />
                        </td>
                        {/* Global duration */}
                        <td style={tdS}>
                          <div style={{ display:"flex", alignItems:"center", gap:2 }}>
                            <input type="number" min={10} max={180}
                              style={{ width:44, padding:"3px 5px", border:"1px solid #e8e5de", borderRadius:5, fontSize:12, fontFamily:"monospace", textAlign:"center" as const, outline:"none" }}
                              value={dur}
                              onChange={e=>{const n=[...subjects] as any[];n[i].sessionDuration=Math.max(10,+e.target.value);setSubjects(n)}} />
                            <span style={{ fontSize:10, color:"#a8a59e" }}>m</span>
                          </div>
                        </td>
                        {/* Global max/day */}
                        <td style={tdS}>
                          <input type="number" min={1} max={6}
                            style={{ width:40, padding:"3px 5px", border:"1px solid #e8e5de", borderRadius:5, fontSize:12, fontFamily:"monospace", textAlign:"center" as const, outline:"none" }}
                            value={maxDay}
                            onChange={e=>{const n=[...subjects] as any[];n[i].maxPeriodsPerDay=Math.max(1,+e.target.value);setSubjects(n)}} />
                        </td>
                        {/* Per-class columns */}
                        {baseClasses.map(cls => {
                          const configs  = (s.classConfigs ?? []) as any[]
                          const existing = configs.find((c:any) => c.sectionName === cls || c.classId === cls)
                          const pw  = existing?.periodsPerWeek  ?? s.periodsPerWeek
                          const mn  = existing?.sessionDuration ?? dur
                          const mx  = existing?.maxPeriodsPerDay ?? maxDay
                          const isOverride = !!existing

                          const upsertCC = (updates: any) => {
                            const n = [...subjects] as any[]
                            const cfgs = [...(n[i].classConfigs ?? [])]
                            const idx  = cfgs.findIndex((c:any) => c.sectionName === cls || c.classId === cls)
                            const next = { sectionName: cls, classId: cls,
                              periodsPerWeek: pw, sessionDuration: mn, maxPeriodsPerDay: mx,
                              ...updates }
                            if (idx >= 0) cfgs[idx] = next; else cfgs.push(next)
                            n[i] = { ...n[i], classConfigs: cfgs }
                            setSubjects(n)
                          }

                          return (
                            <td key={cls} style={{ ...tdS, borderLeft:"2px solid #EDE9FF", background: isOverride ? (i%2===0?"#f5f3ff":"#ede9fe") : (i%2===0?"#fff":"#fafaf9") }}>
                              <div style={{ display:"flex", alignItems:"center", gap:3 }}>
                                {/* Per/week */}
                                <input type="number" min={1} max={30}
                                  style={{ width:36, padding:"2px 3px", border:`1px solid ${isOverride?"#9B8EF5":"#e8e5de"}`, borderRadius:4, fontSize:11, fontFamily:"monospace", textAlign:"center" as const, outline:"none", background: isOverride?"#fdf4ff":"#fff" }}
                                  value={pw}
                                  onChange={e => upsertCC({ periodsPerWeek: Math.max(1,+e.target.value) })} />
                                <span style={{ color:"#c8c5bc", fontSize:10 }}>·</span>
                                {/* Duration */}
                                <input type="number" min={10} max={180}
                                  style={{ width:38, padding:"2px 3px", border:`1px solid ${isOverride?"#9B8EF5":"#e8e5de"}`, borderRadius:4, fontSize:11, fontFamily:"monospace", textAlign:"center" as const, outline:"none", background: isOverride?"#fdf4ff":"#fff" }}
                                  value={mn}
                                  onChange={e => upsertCC({ sessionDuration: Math.max(10,+e.target.value) })} />
                                <span style={{ color:"#c8c5bc", fontSize:10 }}>·</span>
                                {/* Max/day */}
                                <input type="number" min={1} max={6}
                                  style={{ width:30, padding:"2px 3px", border:`1px solid ${isOverride?"#9B8EF5":"#e8e5de"}`, borderRadius:4, fontSize:11, fontFamily:"monospace", textAlign:"center" as const, outline:"none", background: isOverride?"#fdf4ff":"#fff" }}
                                  value={mx}
                                  onChange={e => upsertCC({ maxPeriodsPerDay: Math.max(1,+e.target.value) })} />
                              </div>
                              {isOverride && (
                                <div style={{ fontSize:9, color:"#9B8EF5", marginTop:2 }}>
                                  ✦ override · {Math.round(pw * mn / 60 * 10)/10}h/wk
                                </div>
                              )}
                            </td>
                          )
                        })}
                        {/* Delete */}
                        <td style={tdS}><button style={delBtn} onClick={()=>setSubjects(subjects.filter((_,j)=>j!==i))}>×</button></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ padding:"7px 14px", background:"#f7f6f2", borderTop:"1px solid #e8e5de", fontSize:11, color:"#6a6860", display:"flex", alignItems:"center", gap:12 }}>
              <span>💡 <strong>Global columns</strong> = default for all classes. <strong>Class columns</strong> = override for that class only.</span>
              <span style={{ color:"#9B8EF5", fontWeight:600 }}>✦ purple = overridden</span>
            </div>
            <button style={addRow} onClick={() => setSubjects([...subjects, {
              id: crypto.randomUUID(), name: `${org.subjectLabel} ${subjects.length + 1}`,
              periodsPerWeek: 5, sessionDuration: 40, maxPeriodsPerDay: 2,
              color: "#7C6FE0", sections: [], classConfigs: []
            } as any])}>
              ＋ Add {org.subjectLabel}
            </button>
          </div>
        </div>
      )}

      {/* ── STAFF TAB ── */}
      {tab === "staff" && (
        <div style={{ border:"1.5px solid #e8e5de", borderRadius:12, overflow:"hidden" }}>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead><tr>
              <th style={{...thS, width:36}}>#</th>
              <th style={thS}>Name</th>
              <th style={{...thS, width:80}}>Max/week</th>
              <th style={{...thS, width:110}}>Role</th>
              <th style={{...thS, width:32}}></th>
            </tr></thead>
            <tbody>
              {staff.map((s, i) => (
                <tr key={s.id} style={{ background: i%2===0?"#fff":"#fafaf9" }}>
                  <td style={{...tdS, color:"#a8a59e", fontSize:10, fontFamily:"monospace"}}>{i+1}</td>
                  <td style={tdS}>
                    <input style={inp()} value={s.name} onChange={e=>{const n=[...staff];n[i]={...n[i],name:e.target.value};setStaff(n)}} />
                    {s.isClassTeacher && <span style={{ fontSize:10, color:"#7C6FE0", marginLeft:4 }}>★ CT: {s.isClassTeacher}</span>}
                  </td>
                  <td style={tdS}><input type="number" style={inp({ fontFamily:"monospace", width:60 })} value={s.maxPeriodsPerWeek} onChange={e=>{const n=[...staff];n[i]={...n[i],maxPeriodsPerWeek:+e.target.value};setStaff(n)}} /></td>
                  <td style={tdS}><input style={inp()} value={s.role} onChange={e=>{const n=[...staff];n[i]={...n[i],role:e.target.value};setStaff(n)}} /></td>
                  <td style={tdS}><button style={delBtn} onClick={()=>setStaff(staff.filter((_,j)=>j!==i))}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button style={addRow} onClick={() => {
            const num = staff.length + 1
            setStaff([...staff, { id:crypto.randomUUID(), name:`${org.staffLabel} ${num}`, shortName:"", role:org.staffLabel, subjects:[], classes:[], isClassTeacher:"", maxPeriodsPerWeek:country.maxPeriodsWeek }])
          }}>
            ＋ Add {org.staffLabel} (auto-named "{org.staffLabel} {staff.length + 1}")
          </button>
        </div>
      )}

      {/* ── BREAKS TAB ── */}
      {tab === "breaks" && (
        <div style={{ border:"1.5px solid #e8e5de", borderRadius:12, overflow:"hidden" }}>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead><tr>
              <th style={{...thS, width:36}}>#</th>
              <th style={thS}>Name</th>
              <th style={{...thS, width:90}}>Duration</th>
              <th style={{...thS, width:110}}>Type</th>
              <th style={{...thS, width:80}}>Shiftable</th>
              <th style={{...thS, width:32}}></th>
            </tr></thead>
            <tbody>
              {breaks.map((b, i) => (
                <tr key={b.id} style={{ background: i%2===0?"#fff":"#fafaf9" }}>
                  <td style={{...tdS, color:"#a8a59e", fontSize:10, fontFamily:"monospace"}}>{i+1}</td>
                  <td style={tdS}><input style={inp()} value={b.name} onChange={e=>{const n=[...breaks];n[i]={...n[i],name:e.target.value};setBreaks(n)}} /></td>
                  <td style={tdS}>
                    <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                      <input type="number" style={inp({ fontFamily:"monospace", width:50 })} value={b.duration} onChange={e=>{const n=[...breaks];n[i]={...n[i],duration:+e.target.value};setBreaks(n)}} />
                      <span style={{ fontSize:10, color:"#a8a59e" }}>min</span>
                    </div>
                  </td>
                  <td style={tdS}>
                    <select style={{ fontSize:11, border:"1px solid #e8e5de", borderRadius:6, padding:"4px 6px", background:"#fff" }}
                      value={b.type} onChange={e=>{const n=[...breaks];n[i]={...n[i],type:e.target.value as any};setBreaks(n)}}>
                      {["fixed-start","break","lunch","fixed-end"].map(t=><option key={t}>{t}</option>)}
                    </select>
                  </td>
                  <td style={{...tdS, textAlign:"center" as const}}>
                    <input type="checkbox" checked={b.shiftable} onChange={e=>{const n=[...breaks];n[i]={...n[i],shiftable:e.target.checked};setBreaks(n)}} style={{ width:14, height:14, accentColor:"#7C6FE0", cursor:"pointer" }} />
                  </td>
                  <td style={tdS}><button style={delBtn} onClick={()=>setBreaks(breaks.filter((_,j)=>j!==i))}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button style={addRow} onClick={() => setBreaks([...breaks, { id:`br_${Date.now()}`, name:"New Break", duration:15, type:"break" as const, shiftable:true }])}>
            ＋ Add break / special slot
          </button>
        </div>
      )}

      <div style={{ display:"flex", justifyContent:"space-between", paddingTop:16, borderTop:"1px solid #e8e5de", marginTop:16 }}>
        <button style={navBtn(false)} onClick={()=>setStep(4)}>← Back</button>
        <button style={navBtn(true)} onClick={()=>setStep(6)}>Save & Continue →</button>
      </div>
    </div>
  )
}
