/**
 * HR module — AI Service (Google Gemini)
 * Replaces OpenAI with Google Generative AI (gemini-1.5-flash / gemini-1.5-pro)
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { pdfText } = require('../../../lib/pdfText');
const storage = require('../../core/storage');
const { currentTenantId } = require('../../core/context');
const { workspaceInfo } = require('../../core/tenants');
const logger = require('../../utils/logger');
const { Application, Job } = require('../../models/Recruitment.model');
const Leave = require('../../models/Leave.model');
const User = require('../../models/User.model');

// AI data access is enforced here on the server. Prompt instructions alone are
// never treated as authorization, because a user can try to override them.
const COMPANY_LEAVE_ROLES = new Set(['super_admin', 'admin', 'hr_recruiter']);
const { currentTimezone } = require('../../core/time');

function getBusinessDate(offsetDays = 0) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: currentTimezone(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .formatToParts(new Date())
    .reduce((result, part) => {
      if (part.type !== 'literal') result[part.type] = part.value;
      return result;
    }, {});

  const date = new Date(
    Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)),
  );
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date;
}

function parseLeaveDate(message) {
  const text = String(message || '').toLowerCase();
  // Natural-language leave questions normally use relative business dates.
  // Dates in Leave are stored as UTC calendar-day values, so build the same
  // date boundary from the application's business timezone.
  if (/\btoday\b/.test(text)) return getBusinessDate();
  if (/\btomorrow\b/.test(text)) return getBusinessDate(1);
  if (/\byesterday\b/.test(text)) return getBusinessDate(-1);

  const iso = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) {
    const date = new Date(
      Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])),
    );
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const months = {
    jan: 0,
    january: 0,
    feb: 1,
    february: 1,
    mar: 2,
    march: 2,
    apr: 3,
    april: 3,
    may: 4,
    jun: 5,
    june: 5,
    jul: 6,
    july: 6,
    aug: 7,
    august: 7,
    sep: 8,
    sept: 8,
    september: 8,
    oct: 9,
    october: 9,
    nov: 10,
    november: 10,
    dec: 11,
    december: 11,
  };
  const monthNames = Object.keys(months).join('|');
  const dayFirst = text.match(
    new RegExp(
      `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthNames})(?:\\s*,?\\s*(\\d{4}))?\\b`,
    ),
  );
  const monthFirst = text.match(
    new RegExp(
      `\\b(${monthNames})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,?\\s*(\\d{4}))?\\b`,
    ),
  );
  const match = dayFirst || monthFirst;
  if (!match) return null;

  const isDayFirst = Boolean(dayFirst);
  const day = Number(isDayFirst ? match[1] : match[2]);
  const month = months[isDayFirst ? match[2] : match[1]];
  const year =
    Number(isDayFirst ? match[3] : match[3]) || new Date().getUTCFullYear();
  const date = new Date(Date.UTC(year, month, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month &&
    date.getUTCDate() === day
    ? date
    : null;
}

async function getLeaveLookupContext(message, context) {
  if (!/\bleave\b|\bon leave\b/i.test(message)) return null;
  const date = parseLeaveDate(message);
  if (!date || !context.userId) return null;

  const dayEnd = new Date(date);
  dayEnd.setUTCHours(23, 59, 59, 999);
  const query = {
    status: 'approved',
    startDate: { $lte: dayEnd },
    endDate: { $gte: date },
  };
  let scope = 'your own';

  if (COMPANY_LEAVE_ROLES.has(context.role)) {
    scope = 'company-wide';
  } else if (context.role === 'senior_manager') {
    const teamIds = await User.find({
      reportingManager: context.userId,
    }).distinct('_id');
    query.employee = { $in: [...teamIds, context.userId] };
    scope = 'your team';
  } else {
    query.employee = context.userId;
  }

  const leaves = await Leave.find(query)
    .populate('employee', 'firstName lastName employeeId department')
    .select('employee leaveType startDate endDate totalDays')
    .lean();

  const dateLabel = date.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const rows = leaves.map((leave) => ({
    employee:
      `${leave.employee?.firstName || ''} ${leave.employee?.lastName || ''}`.trim() ||
      'Unknown employee',
    employeeId: leave.employee?.employeeId || '',
    leaveType: leave.leaveType,
    startDate: new Date(leave.startDate).toISOString().slice(0, 10),
    endDate: new Date(leave.endDate).toISOString().slice(0, 10),
  }));

  return `AUTHORIZED LEAVE LOOKUP (source of truth):\n- Date: ${dateLabel}\n- Scope: ${scope}\n- Approved leave records: ${rows.length ? JSON.stringify(rows) : 'None'}\nAnswer only from these records. Do not invent names or disclose information outside this scope.`;
}

// ── Gemini client ─────────────────────────────────────────────────────────────
const companyName = async () => {
  const tenantId = currentTenantId();
  const ws = tenantId ? await workspaceInfo(tenantId).catch(() => null) : null;
  return ws?.name || 'the company';
};

// AI features follow the workspace's plan (AI feature switch in OmniCore).
const assertAiAllowed = async () => {
  const tenantId = currentTenantId();
  const ws = tenantId ? await workspaceInfo(tenantId) : null;
  if (!ws?.aiEnabled) {
    const err = new Error(
      "AI features are not included in this workspace's plan.",
    );
    err.statusCode = 403;
    throw err;
  }
};

const getClient = () => {
  if (!process.env.GEMINI_API_KEY)
    throw new Error('AI is not configured on this server (GEMINI_API_KEY).');
  return new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
};

const getModel = (pro = false) => {
  const genAI = getClient();
  const defaultModel = pro ? 'gemini-pro-latest' : 'gemini-flash-latest';
  const modelName = pro
    ? process.env.GEMINI_PRO_MODEL || defaultModel
    : process.env.GEMINI_MODEL || defaultModel;
  return genAI.getGenerativeModel({
    model: modelName,
    generationConfig: { temperature: 0.4, maxOutputTokens: 2048 },
  });
};

/** Call Gemini and parse JSON from the response */
const callGemini = async (prompt, { pro = false, json = true } = {}) => {
  await assertAiAllowed();
  const model = getModel(pro);
  const result = await model.generateContent(prompt);
  const text = result.response.text().trim();
  if (!json) return text;

  // Strip possible markdown code fences
  const clean = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  return JSON.parse(clean);
};

// ── Extract text from resume PDF ─────────────────────────────────────────────
const extractResumeText = async (resumeUrl) => {
  try {
    // Resumes live in OmniCore file storage; never read arbitrary server paths.
    const key = storage.keyFromUrl(resumeUrl);
    if (!key) throw new Error('Unknown resume location');
    const dataBuffer = await storage.read(key);
    if (!dataBuffer) throw new Error('Resume file not found');
    return await pdfText(dataBuffer);
  } catch (error) {
    logger.error(`Resume extraction failed: ${error.message}`);
    throw new Error('Failed to extract resume text');
  }
};

// ── AI Resume Screening ───────────────────────────────────────────────────────
const screenResume = async (applicationId, jobDetails, resumeText) => {
  try {
    const prompt = `
You are an expert AI HR talent evaluator for ${await companyName()}.
Analyze this resume against the job requirements and return ONLY a valid JSON object — no markdown, no explanation.

JOB:
Title: ${jobDetails.title}
Required Skills: ${jobDetails.skills?.join(', ')}
Experience Required: ${jobDetails.experience?.min}–${jobDetails.experience?.max} years
Requirements:
${jobDetails.requirements?.join('\n')}

RESUME:
${resumeText.slice(0, 4000)}

Return this exact JSON structure:
{
  "score": <0–100 integer>,
  "recommendation": "<strong_yes|yes|maybe|no>",
  "summary": "<2–3 sentence assessment>",
  "strengths": ["<strength 1>","<strength 2>","<strength 3>"],
  "weaknesses": ["<gap 1>","<gap 2>"],
  "skillMatch": [{"skill":"<name>","matched":<true|false>,"score":<0–100>}],
  "experienceMatch": <true|false>,
  "educationMatch": <true|false>,
  "keyHighlights": ["<highlight 1>"],
  "redFlags": []
}

Be objective. Do not discriminate based on name, gender, or ethnicity.
`;

    const result = await callGemini(prompt);

    await Application.findByIdAndUpdate(applicationId, {
      'aiScreening.score': result.score,
      'aiScreening.summary': result.summary,
      'aiScreening.strengths': result.strengths,
      'aiScreening.weaknesses': result.weaknesses,
      'aiScreening.recommendation': result.recommendation,
      'aiScreening.skillMatch': result.skillMatch,
      'aiScreening.processedAt': new Date(),
      stage: result.score >= 70 ? 'shortlisted' : 'rejected',
    });

    logger.info(
      `✅ Gemini resume screening done for ${applicationId}: Score ${result.score}`,
    );
    return result;
  } catch (error) {
    logger.error(`Resume screening failed: ${error.message}`);
    throw error;
  }
};

// ── HR Chat (ARIA) ────────────────────────────────────────────────────────────
const chatWithHR = async (messages, context = {}) => {
  try {
    let userStats = null;
    let companyStats = null;

    if (context.userId) {
      try {
        const mongoose = require('../../core/mongoose');
        const User = mongoose.model('User');
        const Attendance = mongoose.model('Attendance');
        const Payroll = mongoose.model('Payroll');
        const Department = mongoose.model('Department');

        // Fetch User details
        const employee = await User.findById(context.userId).populate(
          'department',
        );

        // Calculate attendance stats for this user
        const attendanceRecords = await Attendance.find({
          employee: context.userId,
        });
        const totalAttendance = attendanceRecords.length;
        const presentCount = attendanceRecords.filter((r) =>
          ['present', 'late', 'work_from_home'].includes(r.status),
        ).length;
        const wfhCount = attendanceRecords.filter(
          (r) => r.status === 'work_from_home',
        ).length;
        const absentCount = attendanceRecords.filter(
          (r) => r.status === 'absent',
        ).length;
        const attendancePercentage =
          totalAttendance > 0
            ? Math.round((presentCount / totalAttendance) * 100)
            : 100;

        // Fetch latest payroll
        const latestPayroll = await Payroll.findOne({
          employee: context.userId,
        }).sort({ 'payPeriod.year': -1, 'payPeriod.month': -1 });

        userStats = {
          employeeId: employee?.employeeId || 'N/A',
          fullName: employee?.fullName || context.name,
          role: employee?.role || context.role,
          position: employee?.position || 'N/A',
          department: employee?.department?.name || context.department || 'N/A',
          dateOfJoining: employee?.dateOfJoining
            ? new Date(employee.dateOfJoining).toLocaleDateString()
            : 'N/A',
          skills: employee?.skills || [],
          salaryBasic: employee?.salary?.basic || 0,
          attendance: {
            percentage: attendancePercentage,
            present: presentCount,
            absent: absentCount,
            wfh: wfhCount,
            totalRecords: totalAttendance,
          },
          latestPayroll: latestPayroll
            ? {
                month: latestPayroll.payPeriod.month,
                year: latestPayroll.payPeriod.year,
                grossEarnings: latestPayroll.grossEarnings,
                totalDeductions: latestPayroll.totalDeductions,
                netSalary: latestPayroll.netSalary,
                status: latestPayroll.status,
              }
            : null,
        };

        // Company-wide figures are available only to HR-level roles.
        if (COMPANY_LEAVE_ROLES.has(context.role)) {
          const totalEmployees = await User.countDocuments({ isActive: true });
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const presentToday = await Attendance.countDocuments({
            date: { $gte: today },
            status: { $in: ['present', 'late', 'work_from_home'] },
          });
          const wfhToday = await Attendance.countDocuments({
            date: { $gte: today },
            status: 'work_from_home',
          });
          const deptsCount = await Department.countDocuments({
            isActive: true,
          });

          companyStats = {
            name: await companyName(),
            totalEmployees,
            presentToday,
            wfhToday,
            activeDepartments: deptsCount,
            activeJobPostings: await Job.countDocuments({ status: 'open' }),
          };
        }
      } catch (err) {
        logger.error(`Failed to load ARIA db context: ${err.message}`);
      }
    }

    const leaveLookup = await getLeaveLookupContext(
      messages[messages.length - 1]?.content,
      context,
    );

    const systemContext = `
You are ARIA (AI Recruitment & HR Intelligence Assistant) for ${await companyName()}.
You are a professional, empathetic HR assistant. 

IMPORTANT: You are directly integrated with this company's HR databases. Only use the authorized data supplied below. Never invent employee records, names, leave status, salaries, or company statistics. Do not disclose information outside the user's authorized scope.

${
  userStats
    ? `CURRENT USER REAL-TIME DATABASE PROFILE:
- Full Name: ${userStats.fullName}
- Employee ID: ${userStats.employeeId}
- Role: ${userStats.role}
- Position: ${userStats.position}
- Department: ${userStats.department}
- Date of Joining: ${userStats.dateOfJoining}
- Skills: ${userStats.skills.join(', ') || 'None listed'}
- Basic Salary: ${userStats.salaryBasic}

USER ATTENDANCE STATS:
- Current Monthly Attendance Percentage: ${userStats.attendance.percentage}% (calculated based on ${userStats.attendance.totalRecords} logged days)
- Logged Days: ${userStats.attendance.present} Present/Late/WFH, ${userStats.attendance.wfh} Work From Home, ${userStats.attendance.absent} Absent.

USER LATEST PAYROLL STATS:
${
  userStats.latestPayroll
    ? `- Pay Period: ${userStats.latestPayroll.month}/${userStats.latestPayroll.year}
- Net Salary: ${userStats.latestPayroll.netSalary}
- Gross Earnings: ${userStats.latestPayroll.grossEarnings}
- Total Deductions: ${userStats.latestPayroll.totalDeductions}
- Payroll Status: ${userStats.latestPayroll.status}`
    : `- No processed payroll records found.`
}
`
    : `USER CONTEXT:
- Role: ${context.role || 'employee'}
- Name: ${context.name || 'User'}
- Department: ${context.department || 'Unknown'}`
}

${
  companyStats
    ? `COMPANY REAL-TIME STATS:
- Company Name: ${companyStats.name}
- Total Active Employees: ${companyStats.totalEmployees}
- Attendance Status Today: ${companyStats.presentToday} checked-in employees (${companyStats.wfhToday} working remotely)
- Active Departments: ${companyStats.activeDepartments}
- Open/Active Job Postings: ${companyStats.activeJobPostings}
`
    : ''
}

${leaveLookup || ''}

Help the user with:
- Recruitment and hiring
- Employee onboarding/offboarding
- HR policies and compliance (such as leave policy, work from home rules)
- Performance management
- Payroll, salary, and benefits queries
- Leave status and attendance percentage

Be concise, helpful, and professional. Use bullet points when listing items. For sensitive HR matters (e.g. disputes), recommend speaking with HR directly.
`;

    // Build conversation history for Gemini (ensuring it starts with a 'user' message)
    const history = [];
    let foundUserMsg = false;
    for (let i = 0; i < messages.length - 1; i++) {
      const m = messages[i];
      if (m.role === 'user') foundUserMsg = true;
      if (foundUserMsg) {
        history.push({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        });
      }
    }

    await assertAiAllowed();
    const model = getModel(false);
    const chat = model.startChat({
      history,
      systemInstruction: { parts: [{ text: systemContext }] },
    });

    const lastMsg = messages[messages.length - 1];
    const result = await chat.sendMessage(lastMsg.content);
    return result.response.text();
  } catch (error) {
    logger.error(`ARIA chat failed: ${error.message}`);
    throw error;
  }
};

// ── Interview Analysis ────────────────────────────────────────────────────────
const analyzeInterview = async (transcript, jobTitle, candidateName) => {
  try {
    const prompt = `
Analyze this interview transcript for ${jobTitle}.
Candidate: ${candidateName}

TRANSCRIPT:
${transcript.slice(0, 3000)}

Return ONLY valid JSON (no markdown):
{
  "overallRating": <1–5>,
  "communicationScore": <1–5>,
  "technicalScore": <1–5>,
  "cultureFitScore": <1–5>,
  "keyInsights": ["<insight>"],
  "concerns": ["<concern>"],
  "recommendation": "<hire|consider|reject>",
  "sentimentAnalysis": "<positive|neutral|negative>",
  "summary": "<2–3 sentence summary>"
}
`;
    return await callGemini(prompt);
  } catch (error) {
    logger.error(`Interview analysis failed: ${error.message}`);
    throw error;
  }
};

// ── Performance Insights ──────────────────────────────────────────────────────
const generatePerformanceInsights = async (employeeData, reviewData) => {
  try {
    const prompt = `
Generate AI performance insights for an employee review.

Employee: ${employeeData.name}, ${employeeData.position}, ${employeeData.department}
Tenure: ${employeeData.tenure} months
Previous Rating: ${employeeData.previousRating || 'N/A'}

Review Data:
${JSON.stringify(reviewData, null, 2)}

Return ONLY valid JSON (no markdown):
{
  "summary": "<comprehensive summary>",
  "predictions": ["<career prediction>"],
  "recommendations": ["<development recommendation>"],
  "riskFlags": ["<retention or performance risk if any>"],
  "promotionReadiness": "<ready|6_months|12_months|not_ready>",
  "keyAchievements": ["<achievement>"],
  "developmentAreas": ["<area>"]
}
`;
    return await callGemini(prompt);
  } catch (error) {
    logger.error(`Performance insights failed: ${error.message}`);
    throw error;
  }
};

// ── Payroll Optimization ──────────────────────────────────────────────────────
const optimizePayroll = async (payrollData, employeeData) => {
  try {
    const prompt = `
Analyze this payroll and suggest tax-efficient optimizations.

Employee: ${employeeData.name}
Tax Regime: ${employeeData.taxRegime}
Location: ${employeeData.location}

Payroll Data:
${JSON.stringify(payrollData, null, 2)}

Return ONLY valid JSON (no markdown):
{
  "taxSavings": <estimated annual savings>,
  "suggestions": [{"item":"<suggestion>","potentialSaving":<amount>,"action":"<action>"}],
  "allowanceOptimization": "<recommendation>",
  "investmentRecommendations": ["<recommendation>"],
  "complianceAlerts": ["<alert if any>"]
}
`;
    return await callGemini(prompt);
  } catch (error) {
    logger.error(`Payroll optimization failed: ${error.message}`);
    throw error;
  }
};

// ── Job Description Generator ─────────────────────────────────────────────────
const generateJobDescription = async (jobTitle, department, requirements) => {
  try {
    const prompt = `
Write a professional, engaging job description for ${await companyName()}.

Role: ${jobTitle}
Department: ${department}
Key Requirements: ${requirements}

Return ONLY valid JSON (no markdown):
{
  "description": "<2–3 paragraph job description>",
  "responsibilities": ["<responsibility 1>","<responsibility 2>","<responsibility 3>","<responsibility 4>","<responsibility 5>"],
  "requirements": ["<requirement 1>","<requirement 2>","<requirement 3>","<requirement 4>"],
  "benefits": ["<benefit 1>","<benefit 2>","<benefit 3>"],
  "skills": ["<skill 1>","<skill 2>","<skill 3>","<skill 4>","<skill 5>"]
}
`;
    return await callGemini(prompt);
  } catch (error) {
    logger.error(`JD generation failed: ${error.message}`);
    throw error;
  }
};

module.exports = {
  extractResumeText,
  screenResume,
  assertAiAllowed,
  chatWithHR,
  analyzeInterview,
  generatePerformanceInsights,
  optimizePayroll,
  generateJobDescription,
};
