package templates

import "github.com/jackymean-del/smart-sched/internal/curriculum"

// SeedTemplates returns the complete built-in curriculum template seed data
// for CBSE, ICSE, IB, and Cambridge across all grade groups.
//
// These are the initial authoritative values. They can be updated later
// only via the approved-change workflow (validator → updater).
//
// Sources:
//   - CBSE: https://cbseacademic.nic.in/
//   - ICSE/ISC: https://www.cisce.org/
//   - IB PYP/MYP/DP: https://www.ibo.org/
//   - Cambridge: https://www.cambridgeinternational.org/
func SeedTemplates() []curriculum.Template {
	var out []curriculum.Template
	add := func(ts ...curriculum.Template) { out = append(out, ts...) }

	// -----------------------------------------------------------------------
	// CBSE
	// -----------------------------------------------------------------------
	add(cbsePreK()...)
	add(cbsePrimary()...)
	add(cbseMiddle()...)
	add(cbseSecondary()...)
	add(cbseSrSec()...)

	// -----------------------------------------------------------------------
	// ICSE / ISC
	// -----------------------------------------------------------------------
	add(icsePreK()...)
	add(icsePrimary()...)
	add(icseMiddle()...)
	add(icseSecondary()...)
	add(iscSrSec()...)

	// -----------------------------------------------------------------------
	// IB PYP → MYP → DP
	// -----------------------------------------------------------------------
	add(ibPYP()...)
	add(ibMYP()...)
	add(ibDP()...)

	// -----------------------------------------------------------------------
	// Cambridge
	// -----------------------------------------------------------------------
	add(cambridgePrimary()...)
	add(cambridgeLowerSec()...)
	add(cambridgeIGCSE()...)
	add(cambridgeALevel()...)

	return out
}

// ---------------------------------------------------------------------------
// helper
// ---------------------------------------------------------------------------

func tpl(board curriculum.Board, gg curriculum.GradeGroup,
	name, short string, slots int,
	lab, lang, act bool, streams []string, mandatory bool, hint string,
) curriculum.Template {
	return curriculum.Template{
		Board: board, GradeGroup: gg,
		SubjectName: name, ShortName: short,
		SlotsPerWeek: slots,
		RequiresLab: lab, IsLanguage: lang, IsActivity: act,
		Streams: streams, IsMandatory: mandatory,
		Hint: hint,
	}
}

var allStreams []string // nil = all streams

// ---------------------------------------------------------------------------
// CBSE
// ---------------------------------------------------------------------------

func cbsePreK() []curriculum.Template {
	b, g := curriculum.BoardCBSE, curriculum.GradeGroupPreK
	return []curriculum.Template{
		tpl(b, g, "English", "ENG", 5, false, true, false, nil, true,
			"Core language — foundational literacy at Nursery/KG level"),
		tpl(b, g, "Hindi", "HIN", 4, false, true, false, nil, true,
			"First/second language — compulsory at all CBSE levels"),
		tpl(b, g, "Mathematics", "MTH", 4, false, false, false, nil, true,
			"Number sense and early arithmetic"),
		tpl(b, g, "Environmental Studies", "EVS", 3, false, false, false, nil, true,
			"Integrated science and social awareness at primary levels"),
		tpl(b, g, "Art & Craft", "ART", 3, false, false, true, nil, false,
			"Creative arts and fine motor development"),
		tpl(b, g, "Physical Education", "PE", 3, false, false, true, nil, false,
			"Physical fitness and motor skills"),
	}
}

func cbsePrimary() []curriculum.Template {
	b, g := curriculum.BoardCBSE, curriculum.GradeGroupPrimary
	return []curriculum.Template{
		tpl(b, g, "English", "ENG", 6, false, true, false, nil, true,
			"Core language — mandatory across all CBSE grades"),
		tpl(b, g, "Hindi", "HIN", 5, false, true, false, nil, true,
			"Second language — compulsory in Class I–VIII CBSE"),
		tpl(b, g, "Mathematics", "MTH", 5, false, false, false, nil, true,
			"Core numeracy — foundational at primary level"),
		tpl(b, g, "Environmental Studies", "EVS", 4, false, false, false, nil, true,
			"Integrated EVS replaces separate Science & Social Studies in I–II"),
		tpl(b, g, "Science", "SCI", 4, false, false, false, nil, true,
			"Introduced as separate subject from Class III"),
		tpl(b, g, "Social Science", "SST", 4, false, false, false, nil, true,
			"History, Geography, Civics — from Class III"),
		tpl(b, g, "Art Education", "ART", 2, false, false, true, nil, false,
			"Visual and performing arts — part of CBSE holistic education"),
		tpl(b, g, "Physical Education", "PE", 2, false, false, true, nil, false,
			"Mandated by NEP 2020 — minimum 45 min/day physical activity"),
		tpl(b, g, "Computer Science", "CS", 2, false, false, false, nil, false,
			"Digital literacy — optional at primary but widely implemented"),
	}
}

func cbseMiddle() []curriculum.Template {
	b, g := curriculum.BoardCBSE, curriculum.GradeGroupMiddle
	return []curriculum.Template{
		tpl(b, g, "English", "ENG", 6, false, true, false, nil, true,
			"Core language — 6 periods/week at middle school"),
		tpl(b, g, "Hindi", "HIN", 5, false, true, false, nil, true,
			"Compulsory second language — VI–VIII"),
		tpl(b, g, "Mathematics", "MTH", 6, false, false, false, nil, true,
			"Core — 6 periods/week including one problem-solving session"),
		tpl(b, g, "Science", "SCI", 5, false, false, false, nil, true,
			"Integrated Physics, Chemistry, Biology"),
		tpl(b, g, "Social Science", "SST", 4, false, false, false, nil, true,
			"History, Geography, Political Science, Economics"),
		tpl(b, g, "Sanskrit", "SKT", 3, false, true, false, nil, false,
			"Optional third language — commonly offered in CBSE schools"),
		tpl(b, g, "Computer Science", "CS", 2, false, false, false, nil, false,
			"IT literacy — recommended by CBSE from Class VI"),
		tpl(b, g, "Art Education", "ART", 2, false, false, true, nil, false,
			"Visual arts or music/dance — part of continuous comprehensive evaluation"),
		tpl(b, g, "Physical Education", "PE", 2, false, false, true, nil, false,
			"Games, yoga and sports — NEP 2020 mandated"),
	}
}

func cbseSecondary() []curriculum.Template {
	b, g := curriculum.BoardCBSE, curriculum.GradeGroupSec
	return []curriculum.Template{
		tpl(b, g, "English", "ENG", 5, false, true, false, nil, true,
			"Core language — Class IX–X board subject"),
		tpl(b, g, "Hindi", "HIN", 5, false, true, false, nil, true,
			"Hindi A or Hindi B — mandatory second language"),
		tpl(b, g, "Mathematics", "MTH", 6, false, false, false, nil, true,
			"Standard or Basic Mathematics — Class X board exam"),
		tpl(b, g, "Science", "SCI", 6, true, false, false, nil, true,
			"Physics, Chemistry, Biology — includes lab periods"),
		tpl(b, g, "Social Science", "SST", 5, false, false, false, nil, true,
			"History, Geography, Political Science, Economics"),
		tpl(b, g, "Computer Science", "CS", 2, false, false, false, nil, false,
			"IT Applications or Artificial Intelligence — elective"),
		tpl(b, g, "Physical Education", "PE", 2, false, false, true, nil, false,
			"Compulsory health and physical education"),
	}
}

func cbseSrSec() []curriculum.Template {
	b, g := curriculum.BoardCBSE, curriculum.GradeGroupSrSec
	sci := []string{"science"}
	com := []string{"commerce"}
	art := []string{"arts"}
	return []curriculum.Template{
		tpl(b, g, "English", "ENG", 5, false, true, false, nil, true,
			"Core English — compulsory across all streams XI–XII"),
		// Science stream
		tpl(b, g, "Physics", "PHY", 5, true, false, false, sci, true,
			"CBSE Physics XI–XII — includes 2 lab periods/week"),
		tpl(b, g, "Chemistry", "CHE", 5, true, false, false, sci, true,
			"CBSE Chemistry XI–XII — includes 2 lab periods/week"),
		tpl(b, g, "Mathematics", "MTH", 6, false, false, false, sci, false,
			"Science stream Mathematics — 6 periods/week (PCM group)"),
		tpl(b, g, "Biology", "BIO", 5, true, false, false, sci, false,
			"Biology — PCB group; includes dissection lab"),
		tpl(b, g, "Computer Science", "CS", 4, false, false, false, sci, false,
			"Python-based CS — popular elective in Science stream"),
		tpl(b, g, "Physical Education", "PE", 2, false, false, true, sci, false,
			"Optional but commonly offered"),
		// Commerce stream
		tpl(b, g, "Accountancy", "ACC", 5, false, false, false, com, true,
			"Accountancy — Commerce stream core XI–XII"),
		tpl(b, g, "Business Studies", "BST", 5, false, false, false, com, true,
			"Business Studies — Commerce stream core"),
		tpl(b, g, "Economics", "ECO", 5, false, false, false, com, true,
			"Economics — core subject across Commerce and some Arts groups"),
		tpl(b, g, "Mathematics", "MTH", 5, false, false, false, com, false,
			"Applied Mathematics — optional in Commerce stream"),
		tpl(b, g, "Informatics Practices", "IP", 4, false, false, false, com, false,
			"Python-based informatics — alternative to CS in Commerce"),
		// Arts / Humanities stream
		tpl(b, g, "History", "HIS", 5, false, false, false, art, true,
			"History — Arts stream core XI–XII"),
		tpl(b, g, "Political Science", "POL", 5, false, false, false, art, true,
			"Political Science / Civics — Arts stream core"),
		tpl(b, g, "Geography", "GEO", 5, false, false, false, art, false,
			"Geography — commonly chosen elective in Arts stream"),
		tpl(b, g, "Sociology", "SOC", 5, false, false, false, art, false,
			"Sociology — popular humanities elective"),
		tpl(b, g, "Psychology", "PSY", 5, false, false, false, art, false,
			"Psychology — increasingly popular at XI–XII"),
		tpl(b, g, "Fine Arts", "FA", 5, false, false, true, art, false,
			"Fine Arts / Music / Dance — elective"),
	}
}

// ---------------------------------------------------------------------------
// ICSE / ISC
// ---------------------------------------------------------------------------

func icsePreK() []curriculum.Template {
	b, g := curriculum.BoardICSE, curriculum.GradeGroupPreK
	return []curriculum.Template{
		tpl(b, g, "English", "ENG", 6, false, true, false, nil, true,
			"English — primary medium of instruction at ICSE schools"),
		tpl(b, g, "Mathematics", "MTH", 4, false, false, false, nil, true,
			"Early number work following CISCE early years framework"),
		tpl(b, g, "Environmental Activities", "EVA", 3, false, false, false, nil, true,
			"Environmental awareness — CISCE Pre-Primary"),
		tpl(b, g, "Art & Craft", "ART", 3, false, false, true, nil, false,
			"Creative arts"),
		tpl(b, g, "Physical Education", "PE", 3, false, false, true, nil, false,
			"Physical development"),
	}
}

func icsePrimary() []curriculum.Template {
	b, g := curriculum.BoardICSE, curriculum.GradeGroupPrimary
	return []curriculum.Template{
		tpl(b, g, "English", "ENG", 7, false, true, false, nil, true,
			"ICSE English — strong language emphasis; 7 periods at primary"),
		tpl(b, g, "Second Language", "L2", 5, false, true, false, nil, true,
			"Hindi / French / Regional language — CISCE mandated"),
		tpl(b, g, "Mathematics", "MTH", 6, false, false, false, nil, true,
			"ICSE Mathematics — higher rigor than CBSE at same grade"),
		tpl(b, g, "Science", "SCI", 4, false, false, false, nil, true,
			"Integrated Science (EVS + basic science concepts)"),
		tpl(b, g, "Social Studies", "SS", 3, false, false, false, nil, true,
			"History, Geography and Civics"),
		tpl(b, g, "Computer Applications", "CA", 2, false, false, false, nil, false,
			"ICT — CISCE curriculum from Class II onwards"),
		tpl(b, g, "Art Education", "ART", 2, false, false, true, nil, false,
			"Fine arts — compulsory in CISCE schools"),
		tpl(b, g, "Physical Education", "PE", 2, false, false, true, nil, false,
			"Games and sports"),
	}
}

func icseMiddle() []curriculum.Template {
	b, g := curriculum.BoardICSE, curriculum.GradeGroupMiddle
	return []curriculum.Template{
		tpl(b, g, "English", "ENG", 7, false, true, false, nil, true,
			"English — core; ICSE allocates more time than CBSE at this level"),
		tpl(b, g, "Second Language", "L2", 5, false, true, false, nil, true,
			"Hindi / French / Sanskrit — second language"),
		tpl(b, g, "Mathematics", "MTH", 6, false, false, false, nil, true,
			"ICSE Mathematics — algebra, geometry, statistics"),
		tpl(b, g, "Physics", "PHY", 4, true, false, false, nil, true,
			"ICSE separates Physics, Chemistry, Biology from Class VI"),
		tpl(b, g, "Chemistry", "CHE", 4, true, false, false, nil, true,
			"Chemistry with lab component from middle school"),
		tpl(b, g, "Biology", "BIO", 4, false, false, false, nil, true,
			"Biology — plant, animal, human systems"),
		tpl(b, g, "History & Civics", "HCI", 3, false, false, false, nil, true,
			"ICSE History & Civics combined paper at Class IX–X"),
		tpl(b, g, "Geography", "GEO", 3, false, false, false, nil, true,
			"Geography — physical and regional"),
		tpl(b, g, "Computer Applications", "CA", 2, false, false, false, nil, false,
			"Java-based or Python — ICSE/ISC popular elective"),
		tpl(b, g, "Art", "ART", 2, false, false, true, nil, false,
			"Drawing, painting, creative arts"),
		tpl(b, g, "Physical Education", "PE", 2, false, false, true, nil, false,
			"Physical development and sports"),
	}
}

func icseSecondary() []curriculum.Template {
	b, g := curriculum.BoardICSE, curriculum.GradeGroupSec
	return []curriculum.Template{
		tpl(b, g, "English", "ENG", 6, false, true, false, nil, true,
			"ICSE English I & II — literature and language; board exam subject"),
		tpl(b, g, "Second Language", "L2", 5, false, true, false, nil, true,
			"Hindi / French / Sanskrit / Regional"),
		tpl(b, g, "Mathematics", "MTH", 6, false, false, false, nil, true,
			"ICSE Mathematics — Class IX–X board paper"),
		tpl(b, g, "Physics", "PHY", 5, true, false, false, nil, true,
			"ICSE Physics — includes practical/lab paper"),
		tpl(b, g, "Chemistry", "CHE", 5, true, false, false, nil, true,
			"ICSE Chemistry — theory + practical"),
		tpl(b, g, "Biology", "BIO", 5, true, false, false, nil, false,
			"ICSE Biology — theory + practical (optional for non-PCB)"),
		tpl(b, g, "History & Civics", "HCI", 4, false, false, false, nil, true,
			"Compulsory group 2 subject in ICSE"),
		tpl(b, g, "Geography", "GEO", 4, false, false, false, nil, true,
			"Compulsory group 2 subject in ICSE"),
		tpl(b, g, "Computer Applications", "CA", 3, false, false, false, nil, false,
			"Java/Python — popular group 3 elective"),
		tpl(b, g, "Commercial Studies", "COM", 3, false, false, false, nil, false,
			"Commerce concepts — ICSE group 3 elective"),
		tpl(b, g, "Physical Education", "PE", 2, false, false, true, nil, false,
			"Health and physical education"),
	}
}

func iscSrSec() []curriculum.Template {
	b, g := curriculum.BoardICSE, curriculum.GradeGroupSrSec
	sci := []string{"science"}
	com := []string{"commerce"}
	art := []string{"arts"}
	return []curriculum.Template{
		tpl(b, g, "English", "ENG", 6, false, true, false, nil, true,
			"ISC English — compulsory; literature + language paper"),
		// Science
		tpl(b, g, "Physics", "PHY", 5, true, false, false, sci, true,
			"ISC Physics — theory + practical paper"),
		tpl(b, g, "Chemistry", "CHE", 5, true, false, false, sci, true,
			"ISC Chemistry — theory + practical"),
		tpl(b, g, "Mathematics", "MTH", 6, false, false, false, sci, false,
			"ISC Mathematics — PCM group"),
		tpl(b, g, "Biology", "BIO", 5, true, false, false, sci, false,
			"ISC Biology — PCB group"),
		tpl(b, g, "Computer Science", "CS", 4, false, false, false, sci, false,
			"ISC Computer Science — Java/Python"),
		// Commerce
		tpl(b, g, "Accounts", "ACC", 5, false, false, false, com, true,
			"ISC Accounts — Commerce core"),
		tpl(b, g, "Business Studies", "BST", 5, false, false, false, com, true,
			"ISC Business Studies"),
		tpl(b, g, "Economics", "ECO", 5, false, false, false, com, true,
			"ISC Economics"),
		tpl(b, g, "Mathematics", "MTH", 5, false, false, false, com, false,
			"ISC Mathematics — optional in Commerce"),
		tpl(b, g, "Commerce", "COM", 4, false, false, false, com, false,
			"ISC Commerce — Trade, Finance"),
		// Arts
		tpl(b, g, "History", "HIS", 5, false, false, false, art, true,
			"ISC History — Arts stream"),
		tpl(b, g, "Political Science", "POL", 5, false, false, false, art, false,
			"ISC Political Science"),
		tpl(b, g, "Sociology", "SOC", 5, false, false, false, art, false,
			"ISC Sociology"),
		tpl(b, g, "Economics", "ECO", 5, false, false, false, art, false,
			"Economics available in Arts stream too"),
	}
}

// ---------------------------------------------------------------------------
// IB PYP (preK / primary) — Primary Years Programme
// ---------------------------------------------------------------------------

func ibPYP() []curriculum.Template {
	addBoth := func(name, short string, slots int,
		lab, lang, act bool, hint string,
	) []curriculum.Template {
		return []curriculum.Template{
			tpl(curriculum.BoardIB, curriculum.GradeGroupPreK, name, short, slots+1,
				lab, lang, act, nil, true, hint+" (PYP Early Years)"),
			tpl(curriculum.BoardIB, curriculum.GradeGroupPrimary, name, short, slots,
				lab, lang, act, nil, true, hint+" (IB PYP)"),
		}
	}
	var out []curriculum.Template
	// IB PYP uses a transdisciplinary framework — 6 subject areas
	out = append(out, addBoth("Language Arts", "LA", 7, false, true, false,
		"IB PYP Language Arts — mother tongue & additional language")...)
	out = append(out, addBoth("Mathematics", "MTH", 6, false, false, false,
		"IB PYP Mathematics — conceptual approach to number, pattern, data")...)
	out = append(out, addBoth("Social Studies", "SS", 4, false, false, false,
		"IB PYP Social Studies — human and natural environments")...)
	out = append(out, addBoth("Science", "SCI", 4, false, false, false,
		"IB PYP Science — living, earth & space, materials & matter")...)
	out = append(out, addBoth("Arts", "ART", 3, false, false, true,
		"IB PYP Arts — visual arts, music, drama, dance")...)
	out = append(out, addBoth("Physical Education", "PE", 3, false, false, true,
		"IB PYP PE — movement, health and wellness")...)
	// Additional language from primary
	out = append(out,
		tpl(curriculum.BoardIB, curriculum.GradeGroupPrimary, "Additional Language", "AL", 3,
			false, true, false, nil, false,
			"IB PYP Additional Language — home language or other"),
	)
	return out
}

// ---------------------------------------------------------------------------
// IB MYP (middle / secondary) — Middle Years Programme
// ---------------------------------------------------------------------------

func ibMYP() []curriculum.Template {
	addBoth := func(name, short string, slotsM, slotsS int,
		lab, lang, act bool, hint string,
	) []curriculum.Template {
		return []curriculum.Template{
			tpl(curriculum.BoardIB, curriculum.GradeGroupMiddle, name, short, slotsM,
				lab, lang, act, nil, true, hint+" (IB MYP)"),
			tpl(curriculum.BoardIB, curriculum.GradeGroupSec, name, short, slotsS,
				lab, lang, act, nil, true, hint+" (IB MYP)"),
		}
	}
	var out []curriculum.Template
	out = append(out, addBoth("Language & Literature", "LL", 5, 5, false, true, false,
		"IB MYP Language & Literature — language A")...)
	out = append(out, addBoth("Language Acquisition", "LA", 4, 4, false, true, false,
		"IB MYP Language Acquisition — language B")...)
	out = append(out, addBoth("Mathematics", "MTH", 5, 6, false, false, false,
		"IB MYP Mathematics — standard or extended")...)
	out = append(out, addBoth("Sciences", "SCI", 5, 5, true, false, false,
		"IB MYP Sciences — integrated; includes lab")...)
	out = append(out, addBoth("Individuals and Societies", "I&S", 4, 4, false, false, false,
		"IB MYP Individuals and Societies — integrated humanities")...)
	out = append(out, addBoth("Arts", "ART", 3, 3, false, false, true,
		"IB MYP Arts — visual arts, music, theatre, film")...)
	out = append(out, addBoth("Physical & Health Education", "PHE", 3, 2, false, false, true,
		"IB MYP Physical & Health Education")...)
	out = append(out, addBoth("Design", "DES", 3, 2, false, false, false,
		"IB MYP Design — digital or product design")...)
	return out
}

// ---------------------------------------------------------------------------
// IB DP (srSec) — Diploma Programme
// ---------------------------------------------------------------------------

func ibDP() []curriculum.Template {
	b, g := curriculum.BoardIB, curriculum.GradeGroupSrSec
	return []curriculum.Template{
		// Group 1 — Language & Literature
		tpl(b, g, "Language A: Literature", "LitA", 5, false, true, false, nil, true,
			"IB DP Language A — literary study in first language"),
		// Group 2 — Language Acquisition
		tpl(b, g, "Language B", "LangB", 4, false, true, false, nil, true,
			"IB DP Language B — second language acquisition"),
		// Group 3 — Individuals and Societies
		tpl(b, g, "History", "HIS", 4, false, false, false, nil, false,
			"IB DP History — world and regional history"),
		tpl(b, g, "Economics", "ECO", 4, false, false, false, nil, false,
			"IB DP Economics — microeconomics, macroeconomics, global economy"),
		tpl(b, g, "Business Management", "BM", 4, false, false, false, nil, false,
			"IB DP Business Management"),
		tpl(b, g, "Geography", "GEO", 4, false, false, false, nil, false,
			"IB DP Geography — physical, human and optional themes"),
		tpl(b, g, "Psychology", "PSY", 4, false, false, false, nil, false,
			"IB DP Psychology"),
		// Group 4 — Sciences
		tpl(b, g, "Physics", "PHY", 5, true, false, false, nil, false,
			"IB DP Physics — HL/SL; includes lab hours"),
		tpl(b, g, "Chemistry", "CHE", 5, true, false, false, nil, false,
			"IB DP Chemistry — HL/SL; includes lab"),
		tpl(b, g, "Biology", "BIO", 5, true, false, false, nil, false,
			"IB DP Biology — HL/SL; includes lab"),
		tpl(b, g, "Computer Science", "CS", 4, false, false, false, nil, false,
			"IB DP Computer Science — HL/SL"),
		tpl(b, g, "Environmental Systems and Societies", "ESS", 4, false, false, false, nil, false,
			"IB DP ESS — interdisciplinary science/humanities"),
		// Group 5 — Mathematics
		tpl(b, g, "Mathematics: Analysis and Approaches", "MAA", 5, false, false, false, nil, true,
			"IB DP Mathematics: Analysis & Approaches — HL/SL"),
		tpl(b, g, "Mathematics: Applications and Interpretation", "MAI", 4, false, false, false, nil, false,
			"IB DP Mathematics: Applications & Interpretation"),
		// Group 6 — Arts
		tpl(b, g, "Visual Arts", "VA", 4, false, false, true, nil, false,
			"IB DP Visual Arts — studio and comparative study"),
		tpl(b, g, "Music", "MUS", 4, false, false, true, nil, false,
			"IB DP Music"),
		tpl(b, g, "Theatre", "THE", 4, false, false, true, nil, false,
			"IB DP Theatre"),
		// DP Core
		tpl(b, g, "Theory of Knowledge", "TOK", 2, false, false, false, nil, true,
			"IB DP TOK — compulsory core component"),
		tpl(b, g, "CAS", "CAS", 2, false, false, true, nil, true,
			"IB DP Creativity Activity Service — compulsory core"),
	}
}

// ---------------------------------------------------------------------------
// Cambridge Primary
// ---------------------------------------------------------------------------

func cambridgePrimary() []curriculum.Template {
	addBoth := func(name, short string, slots int,
		lab, lang, act bool, hint string,
	) []curriculum.Template {
		return []curriculum.Template{
			tpl(curriculum.BoardCambridge, curriculum.GradeGroupPreK, name, short, slots+1,
				lab, lang, act, nil, true, hint+" (Cambridge Early Years)"),
			tpl(curriculum.BoardCambridge, curriculum.GradeGroupPrimary, name, short, slots,
				lab, lang, act, nil, true, hint+" (Cambridge Primary)"),
		}
	}
	var out []curriculum.Template
	out = append(out, addBoth("English", "ENG", 7, false, true, false,
		"Cambridge English — high-emphasis language; 7 periods at primary")...)
	out = append(out, addBoth("Mathematics", "MTH", 6, false, false, false,
		"Cambridge Mathematics — problem-solving approach")...)
	out = append(out, addBoth("Science", "SCI", 4, false, false, false,
		"Cambridge Primary Science — inquiry-based")...)
	out = append(out, addBoth("ICT", "ICT", 2, false, false, false,
		"Cambridge Primary ICT")...)
	out = append(out, addBoth("Art & Design", "ART", 2, false, false, true,
		"Cambridge Primary Art & Design")...)
	out = append(out, addBoth("Physical Education", "PE", 2, false, false, true,
		"Cambridge Primary PE")...)
	// Additional language from primary
	out = append(out,
		tpl(curriculum.BoardCambridge, curriculum.GradeGroupPrimary, "Second Language", "L2", 3,
			false, true, false, nil, false,
			"Cambridge Primary Second Language — French / Spanish / Hindi etc."),
	)
	return out
}

// ---------------------------------------------------------------------------
// Cambridge Lower Secondary (middle)
// ---------------------------------------------------------------------------

func cambridgeLowerSec() []curriculum.Template {
	b, g := curriculum.BoardCambridge, curriculum.GradeGroupMiddle
	return []curriculum.Template{
		tpl(b, g, "English", "ENG", 7, false, true, false, nil, true,
			"Cambridge Lower Secondary English — language and literature"),
		tpl(b, g, "Second Language", "L2", 4, false, true, false, nil, false,
			"Cambridge Lower Secondary Second Language"),
		tpl(b, g, "Mathematics", "MTH", 6, false, false, false, nil, true,
			"Cambridge Lower Secondary Mathematics"),
		tpl(b, g, "Science", "SCI", 5, true, false, false, nil, true,
			"Cambridge Lower Secondary Science — integrated with investigations"),
		tpl(b, g, "History", "HIS", 3, false, false, false, nil, false,
			"Cambridge Lower Secondary History"),
		tpl(b, g, "Geography", "GEO", 3, false, false, false, nil, false,
			"Cambridge Lower Secondary Geography"),
		tpl(b, g, "ICT", "ICT", 3, false, false, false, nil, false,
			"Cambridge Lower Secondary ICT / Digital Literacy"),
		tpl(b, g, "Art & Design", "ART", 2, false, false, true, nil, false,
			"Cambridge Lower Secondary Art & Design"),
		tpl(b, g, "Physical Education", "PE", 2, false, false, true, nil, false,
			"Cambridge Lower Secondary PE"),
		tpl(b, g, "Music", "MUS", 2, false, false, true, nil, false,
			"Cambridge Lower Secondary Music"),
	}
}

// ---------------------------------------------------------------------------
// Cambridge IGCSE (secondary — IX–X equivalent)
// ---------------------------------------------------------------------------

func cambridgeIGCSE() []curriculum.Template {
	b, g := curriculum.BoardCambridge, curriculum.GradeGroupSec
	return []curriculum.Template{
		// Core group — compulsory
		tpl(b, g, "English as a First Language", "ENG1", 6, false, true, false, nil, true,
			"IGCSE English First Language — compulsory; reading, writing, speaking"),
		tpl(b, g, "Mathematics", "MTH", 6, false, false, false, nil, true,
			"IGCSE Mathematics — core or extended tier"),
		// Sciences
		tpl(b, g, "Physics", "PHY", 5, true, false, false, nil, false,
			"IGCSE Physics — includes practical/alternate-to-practical"),
		tpl(b, g, "Chemistry", "CHE", 5, true, false, false, nil, false,
			"IGCSE Chemistry"),
		tpl(b, g, "Biology", "BIO", 5, true, false, false, nil, false,
			"IGCSE Biology"),
		tpl(b, g, "Co-ordinated Sciences", "CS2", 6, true, false, false, nil, false,
			"IGCSE Co-ordinated Sciences — double award covering all three sciences"),
		// Humanities & Languages
		tpl(b, g, "History", "HIS", 4, false, false, false, nil, false,
			"IGCSE History — world and 20th century themes"),
		tpl(b, g, "Geography", "GEO", 4, false, false, false, nil, false,
			"IGCSE Geography"),
		tpl(b, g, "Economics", "ECO", 4, false, false, false, nil, false,
			"IGCSE Economics"),
		tpl(b, g, "Business Studies", "BST", 4, false, false, false, nil, false,
			"IGCSE Business Studies"),
		tpl(b, g, "Second Language", "L2", 4, false, true, false, nil, false,
			"IGCSE Second Language — French / Spanish / Hindi / German etc."),
		tpl(b, g, "Computer Science", "CS", 4, false, false, false, nil, false,
			"IGCSE Computer Science — Python/pseudocode"),
		tpl(b, g, "ICT", "ICT", 3, false, false, false, nil, false,
			"IGCSE Information & Communication Technology"),
		tpl(b, g, "Art & Design", "ART", 4, false, false, true, nil, false,
			"IGCSE Art & Design — coursework + exam"),
		tpl(b, g, "Music", "MUS", 4, false, false, true, nil, false,
			"IGCSE Music"),
		tpl(b, g, "Physical Education", "PE", 2, false, false, true, nil, false,
			"IGCSE Physical Education"),
	}
}

// ---------------------------------------------------------------------------
// Cambridge A Level / AS Level (srSec — XI–XII equivalent)
// ---------------------------------------------------------------------------

func cambridgeALevel() []curriculum.Template {
	b, g := curriculum.BoardCambridge, curriculum.GradeGroupSrSec
	sci := []string{"science"}
	com := []string{"commerce"}
	art := []string{"arts"}
	return []curriculum.Template{
		// Sciences
		tpl(b, g, "Physics", "PHY", 6, true, false, false, sci, false,
			"Cambridge A Level Physics — theory + lab/practical"),
		tpl(b, g, "Chemistry", "CHE", 6, true, false, false, sci, false,
			"Cambridge A Level Chemistry"),
		tpl(b, g, "Biology", "BIO", 6, true, false, false, sci, false,
			"Cambridge A Level Biology"),
		tpl(b, g, "Mathematics", "MTH", 6, false, false, false, sci, false,
			"Cambridge A Level Mathematics — Pure, Mechanics, Statistics"),
		tpl(b, g, "Further Mathematics", "FM", 6, false, false, false, sci, false,
			"Cambridge A Level Further Mathematics"),
		tpl(b, g, "Computer Science", "CS", 5, false, false, false, sci, false,
			"Cambridge A Level Computer Science"),
		// Commerce / Business
		tpl(b, g, "Economics", "ECO", 5, false, false, false, com, false,
			"Cambridge A Level Economics — micro and macro"),
		tpl(b, g, "Business", "BUS", 5, false, false, false, com, false,
			"Cambridge A Level Business"),
		tpl(b, g, "Accounting", "ACC", 5, false, false, false, com, false,
			"Cambridge A Level Accounting"),
		tpl(b, g, "Mathematics", "MTH", 5, false, false, false, com, false,
			"Cambridge A Level Mathematics (Commerce track)"),
		// Humanities / Arts
		tpl(b, g, "History", "HIS", 5, false, false, false, art, false,
			"Cambridge A Level History"),
		tpl(b, g, "Geography", "GEO", 5, false, false, false, art, false,
			"Cambridge A Level Geography"),
		tpl(b, g, "Sociology", "SOC", 5, false, false, false, art, false,
			"Cambridge A Level Sociology"),
		tpl(b, g, "Psychology", "PSY", 5, false, false, false, art, false,
			"Cambridge A Level Psychology"),
		tpl(b, g, "Literature in English", "LIT", 5, false, true, false, art, false,
			"Cambridge A Level Literature in English"),
		tpl(b, g, "Art & Design", "ART", 5, false, false, true, art, false,
			"Cambridge A Level Art & Design"),
		// Compulsory / cross-stream
		tpl(b, g, "English Language", "ENG", 5, false, true, false, nil, true,
			"Cambridge A Level English Language — compulsory across all tracks"),
		tpl(b, g, "General Paper", "GP", 2, false, false, false, nil, false,
			"Cambridge AS General Paper — critical thinking and current affairs"),
	}
}
