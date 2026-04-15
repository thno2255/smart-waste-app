/**
 * exportAllDataToExcel.js
 * ─────────────────────────────────────────────────────────────────────
 * Exports every Firestore collection to a single .xlsx file.
 * Each collection becomes a separate Sheet.
 * Nested objects/arrays are JSON-stringified so no data is lost.
 * ─────────────────────────────────────────────────────────────────────
 */

import { collection, getDocs } from "firebase/firestore";
import * as XLSX from "xlsx";
import { db } from "./firebase";

// ── Collections to export ─────────────────────────────────────────────
const EXPORT_COLLECTIONS = [
  "stations",
  "containers",
  "sensors",
  "alerts",
  "fire_alerts",
  "requests",
  "citizen_reports",
  "users",
  "districts",
  "suctionJobs",
];

// ── Flatten one Firestore document ────────────────────────────────────
// Scalar values are kept as-is.
// Arrays / nested objects are JSON-stringified to keep them readable.
function flattenDoc(id, data) {
  const row = { id };
  for (const [key, val] of Object.entries(data)) {
    if (val === null || val === undefined) {
      row[key] = "";
    } else if (typeof val === "object" && !Array.isArray(val) && val.toDate) {
      // Firestore Timestamp
      row[key] = val.toDate().toISOString();
    } else if (typeof val === "object") {
      // Nested object or array → stringify
      row[key] = JSON.stringify(val);
    } else {
      row[key] = val;
    }
  }
  return row;
}

// ── Fetch all docs from one collection ───────────────────────────────
async function fetchCollection(colName) {
  try {
    const snap = await getDocs(collection(db, colName));
    return snap.docs.map((d) => flattenDoc(d.id, d.data()));
  } catch (e) {
    console.warn(`[export] "${colName}" failed:`, e.message);
    return [];
  }
}

// ── Build worksheet from rows ────────────────────────────────────────
function buildSheet(rows) {
  if (rows.length === 0) {
    // Empty sheet with a note
    return XLSX.utils.aoa_to_sheet([["لا توجد بيانات في هذه المجموعة"]]);
  }

  // Collect all unique keys across all rows (order: id first)
  const keysSet = new Set();
  rows.forEach((r) => Object.keys(r).forEach((k) => keysSet.add(k)));
  const keys = ["id", ...[...keysSet].filter((k) => k !== "id")];

  // Build 2-D array: header row + data rows
  const aoa = [
    keys,
    ...rows.map((r) => keys.map((k) => (r[k] !== undefined ? r[k] : ""))),
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Auto column widths
  const colWidths = keys.map((k) => {
    const maxLen = Math.max(
      k.length,
      ...rows.map((r) => String(r[k] ?? "").length)
    );
    return { wch: Math.min(maxLen + 2, 60) };
  });
  ws["!cols"] = colWidths;

  return ws;
}

// ── Main export function ──────────────────────────────────────────────
export async function exportAllDataToExcel(filename = "full_database.xlsx") {
  const wb = XLSX.utils.book_new();

  for (const colName of EXPORT_COLLECTIONS) {
    const rows = await fetchCollection(colName);
    const ws = buildSheet(rows);
    // Sheet names max 31 chars, no special chars
    const sheetName = colName.slice(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  // Trigger browser download
  XLSX.writeFile(wb, filename);
}
