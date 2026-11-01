export const SEVERITY = {high: 3, medium: 2, low: 1};
export const TOPIC_COLORS = ['#d68c68', '#a2b185', '#83a7a1', '#a69db6', '#c4ab73'];
export const tokens = value => value.toLocaleLowerCase('en').match(/[\p{L}\p{N}]+/gu) || [];
export function matchesSearch(report, query) {
  const words = new Set(tokens([report.title, report.body, report.incident, report.category, report.location, report.source].join(' ')));
  return tokens(query).every(term => words.has(term));
}
export function validateDataset(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100) throw new Error('The dataset needs a name (up to 100 characters).');
  if (!Array.isArray(input.reports) || !input.reports.length || input.reports.length > 5000) throw new Error('Include between 1 and 5,000 reports in the reports array.');
  const ids = new Set();
  const limits = {id: 80, title: 200, body: 8000, topic: 80, incident: 150, category: 80, location: 150, source: 80, status: 80, timestamp: 40};
  const reports = input.reports.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Report ${index + 1} must be an object.`);
    const report = {};
    for (const [field, limit] of Object.entries(limits)) {
      if (typeof raw[field] !== 'string' || !raw[field].trim() || raw[field].length > limit) throw new Error(`Report ${index + 1}: ${field} is required (up to ${limit} characters).`);
      report[field] = raw[field].trim();
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(report.id) || ['__proto__','constructor','prototype'].includes(report.id) || ids.has(report.id)) throw new Error(`Report ${index + 1}: use unique IDs containing letters, numbers, hyphens or underscores.`);
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(report.timestamp) || !Number.isFinite(Date.parse(report.timestamp))) throw new Error(`Report ${index + 1}: timestamp must be an ISO date with a timezone.`);
    if (typeof raw.severity !== 'string' || !Object.hasOwn(SEVERITY, raw.severity)) throw new Error(`Report ${index + 1}: severity must be low, medium or high.`);
    const parts = report.timestamp.match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)/).slice(1).map(Number);
    const [year, month, day, hour, minute, second] = parts;
    const days = [31, (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : 28, 31,30,31,30,31,31,30,31,30,31];
    const offset = report.timestamp.match(/[+-](\d\d):(\d\d)$/);
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month-1] || hour > 23 || minute > 59 || second > 59 || (offset && (Number(offset[1]) > 23 || Number(offset[2]) > 59))) throw new Error(`Report ${index + 1}: timestamp must be a valid calendar date.`);
    report.severity = raw.severity;
    report.timestamp = new Date(report.timestamp).toISOString();
    ids.add(report.id);
    return report;
  });
  reports.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.id.localeCompare(b.id));
  return {name: input.name.trim(), description: typeof input.description === 'string' ? input.description.slice(0, 500) : '', reports};
}
export function timeBins(reports) {
  if (!reports.length) return [];
  const min = Date.parse(reports[0].timestamp);
  const max = Date.parse(reports.at(-1).timestamp);
  const width = Math.max(600000, Math.ceil((max - min + 1) / 12 / 600000) * 600000);
  const start = Math.floor(min / width) * width;
  const count = Math.ceil((max - start + 1) / width);
  return Array.from({length: count}, (_, i) => ({start: start + i * width, end: start + (i + 1) * width}));
}
export function filterReports(reports, filters, evidence = {}, queryIds = null) {
  return reports.filter(r => (!filters.savedOnly || evidence[r.id]?.saved)
    && (!filters.topic || r.topic === filters.topic)
    && (!filters.category || r.category === filters.category)
    && (!filters.severity || r.severity === filters.severity)
    && (!filters.source || r.source === filters.source)
    && (!filters.time || (Date.parse(r.timestamp) >= filters.time.start && Date.parse(r.timestamp) < filters.time.end))
    && (!filters.query || (queryIds ? queryIds.has(r.id) : matchesSearch(r, filters.query))));
}
export function sortReports(reports, sort) {
  return [...reports].sort((a, b) => (sort === 'severity' ? SEVERITY[b.severity] - SEVERITY[a.severity] : 0)
    || (sort === 'oldest' ? Date.parse(a.timestamp) - Date.parse(b.timestamp) : Date.parse(b.timestamp) - Date.parse(a.timestamp))
    || a.id.localeCompare(b.id));
}
export function buildBrief(dataset, reports, evidence) {
  const saved = dataset.reports.filter(r => evidence[r.id]?.saved);
  const selection = saved.length ? saved : reports;
  const safe = value => String(value).replace(/[\r\n]+/g, ' ').replace(/([\\`*_{}[\]<>#|])/g, '\\$1');
  const lines = ['# Signal Desk — investigation brief', '', `Dataset: ${safe(dataset.name)}`, `Exported: ${new Date().toISOString()}`, `Selection: ${saved.length ? 'Saved evidence (across the entire dataset)' : 'Current filtered view'}`, `Reports: ${selection.length}`, '', 'Original demo data is fictional. Imported data is user supplied. Source and status labels are dataset claims, not independent verification.', ''];
  for (const r of sortReports(selection, 'oldest')) {
    lines.push(`## ${safe(r.title)}`, '', `- ID: ${safe(r.id)}`, `- Time: ${r.timestamp}`, `- Incident: ${safe(r.incident)}`, `- Location: ${safe(r.location)}`, `- Source: ${safe(r.source)}`, `- Severity: ${safe(r.severity)}`, `- Status: ${safe(r.status)}`, '', safe(r.body), '');
    if (evidence[r.id]?.note) lines.push('### Investigator note', '', safe(evidence[r.id].note), '');
  }
  return lines.join('\n');
}
