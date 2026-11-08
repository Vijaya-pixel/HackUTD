// Demo data for ScamShield (T-Life feature extension)
const LINES = [
  { id: 0, name: "Harsh", device: "Harsh's iPhone 17 Pro", num: "(206) 555-0101", initials: "HR", primary: true },
  { id: 1, name: "Marco", device: "Marco's Galaxy S25", num: "(206) 555-0177", initials: "MR" },
  { id: 2, name: "Rosa", device: "Grandma Rosa's iPhone 15", num: "(425) 555-0133", initials: "RM" },
];

// type: blocked | scam | spam | identified | screened | ai | fraud | allowed
const ACTIVITY = [
  { id: 1,  line: 0, num: "(312) 555-0107", name: null, type: "blocked",    cat: "Scam Likely",        loc: "Chicago, IL",    ago: 14,   risk: 96, reports: 1248, times: 3, note: "Impersonating a bank fraud department" },
  { id: 2,  line: 0, num: "(206) 555-0188", name: null, type: "scam",       cat: "Scam Likely",        loc: "Seattle, WA",    ago: 52,   risk: 88, reports: 412,  times: 1, note: "Neighbor spoofing — matches your area code and prefix" },
  { id: 3,  line: 0, num: "(800) 555-0144", name: "Comcast Xfinity", type: "identified", cat: "Business", loc: "Toll-free", ago: 95, risk: 8, reports: 3, times: 1 },
  { id: 4,  line: 0, num: "(917) 555-0162", name: null, type: "spam",       cat: "Telemarketing",      loc: "New York, NY",   ago: 180,  risk: 61, reports: 230,  times: 2, note: "Extended auto warranty" },
  { id: 5,  line: 0, num: "(702) 555-0119", name: null, type: "fraud",      cat: "Fraud detected",     loc: "Las Vegas, NV",  ago: 1440, risk: 99, reports: 2100, times: 1, note: "Asked for a one-time passcode and gift card payment" },
  { id: 6,  line: 0, num: "(425) 555-0170", name: "Dr. Patel Dental", type: "identified", cat: "Healthcare", loc: "Bellevue, WA", ago: 1500, risk: 2, reports: 0, times: 1 },
  { id: 7,  line: 0, num: "(404) 555-0151", name: null, type: "screened",   cat: "Unknown caller",     loc: "Atlanta, GA",    ago: 1620, risk: 44, reports: 18,   times: 1, note: "Hung up when asked who was calling" },
  { id: 8,  line: 0, num: "(213) 555-0126", name: null, type: "ai",         cat: "AI voice detected",  loc: "Los Angeles, CA",ago: 2880, risk: 91, reports: 640,  times: 1, note: "Synthetic voice claiming to be a family member" },
  { id: 9,  line: 0, num: "(206) 555-0199", name: null, type: "blocked",    cat: "Scam Likely",        loc: "Seattle, WA",    ago: 2950, risk: 93, reports: 870,  times: 5 },
  { id: 10, line: 0, num: "(512) 555-0138", name: null, type: "spam",       cat: "Survey",             loc: "Austin, TX",     ago: 4300, risk: 38, reports: 76,   times: 1 },
  { id: 11, line: 0, num: "(646) 555-0110", name: null, type: "spam",       cat: "Political",          loc: "New York, NY",   ago: 4400, risk: 30, reports: 54,   times: 1 },
  { id: 12, line: 0, num: "(888) 555-0122", name: "Chase Fraud Alerts", type: "identified", cat: "Financial", loc: "Toll-free", ago: 5800, risk: 5, reports: 1, times: 1 },
  { id: 13, line: 1, num: "(305) 555-0183", name: null, type: "blocked",    cat: "Scam Likely",        loc: "Miami, FL",      ago: 30,   risk: 94, reports: 980,  times: 2 },
  { id: 14, line: 1, num: "(206) 555-0145", name: "Roosevelt High School", type: "identified", cat: "Education", loc: "Seattle, WA", ago: 240, risk: 1, reports: 0, times: 1 },
  { id: 15, line: 1, num: "(747) 555-0102", name: null, type: "spam",       cat: "Telemarketing",      loc: "Burbank, CA",    ago: 1300, risk: 58, reports: 190,  times: 1 },
  { id: 16, line: 2, num: "(866) 555-0176", name: null, type: "fraud",      cat: "Fraud detected",     loc: "Toll-free",      ago: 75,   risk: 99, reports: 3400, times: 1, note: "'Grandparent scam' — caller claimed to be a grandson in jail" },
  { id: 17, line: 2, num: "(425) 555-0149", name: null, type: "blocked",    cat: "Scam Likely",        loc: "Redmond, WA",    ago: 600,  risk: 90, reports: 720,  times: 4 },
  { id: 18, line: 2, num: "(425) 555-0170", name: "Dr. Patel Dental", type: "identified", cat: "Healthcare", loc: "Bellevue, WA", ago: 2000, risk: 2, reports: 0, times: 1 },
  { id: 19, line: 2, num: "(818) 555-0160", name: null, type: "ai",         cat: "AI voice detected",  loc: "Los Angeles, CA",ago: 2700, risk: 95, reports: 510,  times: 1, note: "Cloned voice asking for emergency money" },
];

const CATEGORIES = [
  { id: "fraud",         name: "Scam & fraud",    desc: "Known scam and fraud numbers",        est: 22, icon: "shieldAlert", locked: false },
  { id: "telemarketing", name: "Telemarketing",   desc: "Sales calls and warranty offers",      est: 14, icon: "megaphone" },
  { id: "survey",        name: "Surveys",         desc: "Market research and polling",          est: 5,  icon: "clipboard" },
  { id: "political",     name: "Political",       desc: "Campaign and fundraising calls",       est: 4,  icon: "vote" },
  { id: "nuisance",      name: "Nuisance",        desc: "Robocalls and debt collectors",        est: 9,  icon: "phoneOff" },
  { id: "unknown",       name: "Unknown callers", desc: "Anyone not in your contacts",          est: 31, icon: "user" },
];

const LOOKUP_DB = {
  "3125550107": { name: "Unknown", carrier: "VoIP (Bandwidth)", type: "VoIP", loc: "Chicago, IL", risk: 96, reports: 1248, cat: "Scam Likely", note: "Bank impersonation scam. Reported by T-Mobile customers in 41 states." },
  "8005550144": { name: "Comcast Xfinity", carrier: "Toll-free", type: "Business", loc: "Philadelphia, PA", risk: 8, reports: 3, cat: "Business", note: "Verified business number." },
  "7025550119": { name: "Unknown", carrier: "VoIP", type: "VoIP", loc: "Las Vegas, NV", risk: 99, reports: 2100, cat: "Fraud", note: "Requests one-time passcodes and gift cards." },
  "2065550188": { name: "Unknown", carrier: "T-Mobile (spoofed)", type: "Mobile", loc: "Seattle, WA", risk: 88, reports: 412, cat: "Scam Likely", note: "Neighbor spoofing. The number may belong to a real customer." },
  "4255550170": { name: "Dr. Patel Dental", carrier: "Lumen", type: "Business", loc: "Bellevue, WA", risk: 2, reports: 0, cat: "Healthcare", note: "Verified business number." },
};

const PERKS = [
  { brand: "7-Eleven", title: "Free coffee or Big Gulp", bg: "linear-gradient(135deg,#FF7A00,#E20074)" },
  { brand: "Shell", title: "15¢ off per gallon", bg: "linear-gradient(135deg,#FFC800,#E8402A)" },
  { brand: "Little Caesars", title: "$5 off any pizza", bg: "linear-gradient(135deg,#FF6A00,#C70039)" },
];
