// Package sources manages the trusted registry of official board curriculum
// document sources. New sources are added here; the monitor fetches them.
package sources

import "github.com/jackymean-del/smart-sched/internal/curriculum"

// TrustedRegistry is the built-in list of known-good official curriculum
// source URLs. These are seeded into the curriculum_sources table on first
// run if they don't already exist. Admins can add custom sources via the API.
//
// Sources are public documents published by curriculum authorities
// (CBSE, CISCE, IBO, Cambridge). No authentication required.
var TrustedRegistry = []curriculum.Source{
	// -----------------------------------------------------------------------
	// CBSE — Central Board of Secondary Education
	// -----------------------------------------------------------------------
	{
		Board:              curriculum.BoardCBSE,
		URL:                "https://cbseacademic.nic.in/web_material/CurriculumMain23/Secondary/Curriculum_S_2023.pdf",
		Name:               "CBSE Secondary Curriculum 2023 (Class IX–X)",
		FetchIntervalHours: 48,
		Enabled:            true,
	},
	{
		Board:              curriculum.BoardCBSE,
		URL:                "https://cbseacademic.nic.in/web_material/CurriculumMain23/SrSecondary/Curriculum_SS_2023.pdf",
		Name:               "CBSE Senior Secondary Curriculum 2023 (Class XI–XII)",
		FetchIntervalHours: 48,
		Enabled:            true,
	},
	{
		Board:              curriculum.BoardCBSE,
		URL:                "https://cbseacademic.nic.in/web_material/CurriculumMain23/Primary/Curriculum_P_2023.pdf",
		Name:               "CBSE Primary Curriculum 2023 (Class I–V)",
		FetchIntervalHours: 72,
		Enabled:            true,
	},
	{
		Board:              curriculum.BoardCBSE,
		URL:                "https://cbseacademic.nic.in/web_material/CurriculumMain23/Middle/Curriculum_M_2023.pdf",
		Name:               "CBSE Middle School Curriculum 2023 (Class VI–VIII)",
		FetchIntervalHours: 72,
		Enabled:            true,
	},

	// -----------------------------------------------------------------------
	// ICSE / ISC — Council for the Indian School Certificate Examinations
	// -----------------------------------------------------------------------
	{
		Board:              curriculum.BoardICSE,
		URL:                "https://www.cisce.org/pdf/ICSE-Regulations-Syllabus2024.pdf",
		Name:               "ICSE Regulations & Syllabus 2024 (Class I–X)",
		FetchIntervalHours: 72,
		Enabled:            true,
	},
	{
		Board:              curriculum.BoardICSE,
		URL:                "https://www.cisce.org/pdf/ISC-Regulations-Syllabus2024.pdf",
		Name:               "ISC Regulations & Syllabus 2024 (Class XI–XII)",
		FetchIntervalHours: 72,
		Enabled:            true,
	},

	// -----------------------------------------------------------------------
	// IB — International Baccalaureate
	// -----------------------------------------------------------------------
	{
		Board:              curriculum.BoardIB,
		URL:                "https://resources.ibo.org/data/pyp-programme-standards-practices_en.pdf",
		Name:               "IB PYP Programme Standards & Practices",
		FetchIntervalHours: 168, // weekly — IB updates less frequently
		Enabled:            true,
	},
	{
		Board:              curriculum.BoardIB,
		URL:                "https://resources.ibo.org/data/myp-principles-into-practice_en.pdf",
		Name:               "IB MYP Principles into Practice",
		FetchIntervalHours: 168,
		Enabled:            true,
	},
	{
		Board:              curriculum.BoardIB,
		URL:                "https://resources.ibo.org/data/dp-curriculum-handbook_en.pdf",
		Name:               "IB Diploma Programme Curriculum Handbook",
		FetchIntervalHours: 168,
		Enabled:            true,
	},

	// -----------------------------------------------------------------------
	// Cambridge — Cambridge Assessment International Education
	// -----------------------------------------------------------------------
	{
		Board:              curriculum.BoardCambridge,
		URL:                "https://www.cambridgeinternational.org/Images/271294-cambridge-primary-curriculum-framework.pdf",
		Name:               "Cambridge Primary Curriculum Framework",
		FetchIntervalHours: 168,
		Enabled:            true,
	},
	{
		Board:              curriculum.BoardCambridge,
		URL:                "https://www.cambridgeinternational.org/Images/271286-cambridge-lower-secondary-curriculum-framework.pdf",
		Name:               "Cambridge Lower Secondary Curriculum Framework",
		FetchIntervalHours: 168,
		Enabled:            true,
	},
	{
		Board:              curriculum.BoardCambridge,
		URL:                "https://www.cambridgeinternational.org/Images/657092-cambridge-igcse-syllabuses-for-2024-2025.pdf",
		Name:               "Cambridge IGCSE Syllabuses 2024–25",
		FetchIntervalHours: 168,
		Enabled:            true,
	},
}
