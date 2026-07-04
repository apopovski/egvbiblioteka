const SHEET_NAME = 'Pitanja';

function getOrCreateSheet_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (sheet) return sheet;

  const created = SpreadsheetApp.getActiveSpreadsheet().insertSheet(SHEET_NAME);
  created.appendRow([
    'Timestamp',
    'Pitanje',
    'Ime',
    'Email',
    'Jezik',
    'Izvor',
    'Stranica',
    'Poslato (ISO)',
  ]);
  return created;
}

function jsonOutput_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    const data = JSON.parse(raw);

    const question = String(data.question || '').trim();
    if (!question || question.length < 12) {
      return jsonOutput_({ ok: false, error: 'Pitanje je prekratko.' });
    }

    const name = String(data.name || '').trim();
    const email = String(data.email || '').trim();
    const language = String(data.language || 'sr').trim();
    const source = String(data.source || 'egv-biblioteka-qa').trim();
    const page = String(data.page || '').trim();
    const submittedAt = String(data.submittedAt || new Date().toISOString()).trim();

    const sheet = getOrCreateSheet_();
    sheet.appendRow([
      new Date(),
      question,
      name,
      email,
      language,
      source,
      page,
      submittedAt,
    ]);

    return jsonOutput_({ ok: true });
  } catch (error) {
    return jsonOutput_({ ok: false, error: String(error) });
  }
}
