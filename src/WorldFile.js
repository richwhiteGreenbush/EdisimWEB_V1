// Explicit save/load of the whole world as a portable .json file, distinct from the
// automatic IndexedDB persistence -- this lets a user back up or share a specific
// world state, or roll back to one, separate from "whatever I last touched."

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64, type) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

async function serializeRecord(record) {
  if (!record.files) return record;
  const files = await Promise.all(
    record.files.map(async (f) => ({ name: f.name, type: f.type, dataBase64: await blobToBase64(f.data) }))
  );
  return { ...record, files };
}

function deserializeRecord(record) {
  if (!record.files) return record;
  const files = record.files.map((f) => ({ name: f.name, type: f.type, data: base64ToBlob(f.dataBase64, f.type) }));
  return { ...record, files };
}

export async function exportWorldToFile(records) {
  const serialized = await Promise.all(records.map(serializeRecord));
  const payload = { format: 'edusim-world', version: 1, exportedAt: Date.now(), records: serialized };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    a.download = `edusim-world-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function readWorldFile(file) {
  const text = await file.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  if (!payload || !Array.isArray(payload.records)) {
    throw new Error('That file is not an Edusim world save.');
  }
  return payload.records.map(deserializeRecord);
}
